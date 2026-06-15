import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { getGscAccessToken } from '../routes/gsc'
import { createAlert, resolveAlert } from '../lib/alerts'
import { BULL_CONNECTION } from '../lib/queue'

async function getOrgId(siteId: string): Promise<string> {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { org_id: true } })
  if (!site) throw new Error(`Site ${siteId} not found`)
  return site.org_id
}

// ─── GSC API helpers ──────────────────────────────────────────────────────────

async function searchAnalyticsQuery(
  accessToken: string,
  propertyUrl: string,
  body: Record<string, unknown>,
): Promise<{ rows?: Array<Record<string, unknown>> }> {
  const encoded = encodeURIComponent(propertyUrl)
  const resp = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`GSC searchAnalytics error ${resp.status}: ${text}`)
  }
  return resp.json() as Promise<{ rows?: Array<Record<string, unknown>> }>
}

async function getSitemapIndexCount(
  accessToken: string,
  propertyUrl: string,
): Promise<{ indexed: number; submitted: number } | null> {
  const encoded = encodeURIComponent(propertyUrl)
  const resp = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encoded}/sitemaps`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    },
  )
  if (!resp.ok) return null
  const data = await resp.json() as { sitemap?: Array<{ contents?: Array<{ type: string; submitted: number; indexed: number }> }> }
  let totalIndexed = 0, totalSubmitted = 0
  for (const sm of data.sitemap ?? []) {
    for (const c of sm.contents ?? []) {
      if (c.type === 'WEB') {
        totalIndexed   += c.indexed   ?? 0
        totalSubmitted += c.submitted ?? 0
      }
    }
  }
  return { indexed: totalIndexed, submitted: totalSubmitted }
}

// ─── Main pull function ───────────────────────────────────────────────────────

export async function runGscPull(siteId: string): Promise<void> {
  let accessToken: string
  let conn: { id: string; property_url: string }

  try {
    const result = await getGscAccessToken(siteId)
    accessToken = result.accessToken
    conn = result.conn
  } catch (err) {
    const msg = (err as Error).message
    if (msg === 'GSC_NOT_CONNECTED') return
    if (msg === 'REVOKED') {
      await handleRevoked(siteId)
      return
    }
    throw err
  }

  const today = new Date(); today.setUTCHours(0, 0, 0, 0)
  // GSC data lags ~3 days; pull yesterday's confirmed data
  const endDate   = new Date(today.getTime() - 3 * 86_400_000).toISOString().slice(0, 10)
  const startDate = new Date(today.getTime() - 35 * 86_400_000).toISOString().slice(0, 10)

  // ── 1. Daily site-level totals ─────────────────────────────────────────────
  const dailyData = await searchAnalyticsQuery(accessToken, conn.property_url, {
    startDate,
    endDate,
    dimensions: ['date'],
    rowLimit: 35,
  })

  for (const row of (dailyData.rows ?? []) as Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>) {
    const date = new Date(row.keys[0])
    await prisma.seoDaily.upsert({
      where: { site_id_date: { site_id: siteId, date } },
      create: {
        site_id:      siteId,
        date,
        clicks:       row.clicks,
        impressions:  row.impressions,
        ctr:          row.ctr,
        avg_position: row.position,
      },
      update: {
        clicks:       row.clicks,
        impressions:  row.impressions,
        ctr:          row.ctr,
        avg_position: row.position,
      },
    })
  }

  // ── 2. Top queries (last 7 days) ──────────────────────────────────────────
  const last7End   = endDate
  const last7Start = new Date(new Date(endDate).getTime() - 6 * 86_400_000).toISOString().slice(0, 10)

  const queryData = await searchAnalyticsQuery(accessToken, conn.property_url, {
    startDate:  last7Start,
    endDate:    last7End,
    dimensions: ['query'],
    rowLimit:   25,
  })

  // Get existing priority queries to preserve that flag
  const prioritySet = new Set(
    (await prisma.seoQuery.findMany({
      where: { site_id: siteId, is_priority: true },
      select: { query: true },
    })).map(q => q.query),
  )

  const queryDate = new Date(last7End)
  for (const row of (queryData.rows ?? []) as Array<{ keys: string[]; clicks: number; impressions: number; position: number }>) {
    const query = row.keys[0]
    await prisma.seoQuery.upsert({
      where: { site_id_date_query: { site_id: siteId, date: queryDate, query } },
      create: {
        site_id:     siteId,
        date:        queryDate,
        query,
        clicks:      row.clicks,
        impressions: row.impressions,
        position:    row.position,
        is_priority: prioritySet.has(query),
      },
      update: {
        clicks:      row.clicks,
        impressions: row.impressions,
        position:    row.position,
      },
    })
  }

  // ── 3. Index count via sitemaps ───────────────────────────────────────────
  const indexCounts = await getSitemapIndexCount(accessToken, conn.property_url)
  if (indexCounts) {
    await prisma.seoIndexStatus.upsert({
      where: { site_id_date: { site_id: siteId, date: today } },
      create: {
        site_id:            siteId,
        date:               today,
        indexed_count:      indexCounts.indexed,
        excluded_noindex:   0,
        crawled_not_indexed:0,
        server_errors:      0,
      },
      update: {
        indexed_count: indexCounts.indexed,
      },
    })

    await checkIndexDropAlert(siteId, indexCounts.indexed)
  }

  // ── 4. Traffic drop alert (WoW) ───────────────────────────────────────────
  await checkTrafficDropAlert(siteId)

  // Clear any revoked alert if we got here successfully
  await resolveAlert(prisma, siteId, 'gsc.connection_revoked')
}

// ─── Alert checks ─────────────────────────────────────────────────────────────

async function checkTrafficDropAlert(siteId: string) {
  const today     = new Date(); today.setUTCHours(0, 0, 0, 0)
  const last7Start = new Date(today.getTime() - 7 * 86_400_000)
  const prev7Start = new Date(today.getTime() - 14 * 86_400_000)

  const daily = await prisma.seoDaily.findMany({
    where: { site_id: siteId, date: { gte: prev7Start } },
    select: { date: true, clicks: true },
  })

  const last7 = daily.filter(d => d.date >= last7Start).reduce((s, r) => s + r.clicks, 0)
  const prev7 = daily.filter(d => d.date >= prev7Start && d.date < last7Start).reduce((s, r) => s + r.clicks, 0)

  const MIN_BASELINE = 50
  if (prev7 >= MIN_BASELINE && last7 < prev7 * 0.7) {
    const pct = Math.round((1 - last7 / prev7) * 100)
    const orgId = await getOrgId(siteId)
    await createAlert(prisma, {
      siteId,
      orgId,
      rule:     'gsc.traffic_drop',
      severity: 'warning',
      title:    `Search traffic down ${pct}% this week`,
      body:     `Clicks dropped from ${prev7} last week to ${last7} this week (−${pct}%). Check for ranking changes or indexing issues.`,
    })
  } else {
    await resolveAlert(prisma, siteId, 'gsc.traffic_drop')
  }
}

async function checkIndexDropAlert(siteId: string, currentIndexed: number) {
  const prev = await prisma.seoIndexStatus.findFirst({
    where: { site_id: siteId },
    orderBy: { date: 'desc' },
    skip: 1,
    select: { indexed_count: true, date: true },
  })

  if (!prev || prev.indexed_count === 0) return

  const drop = (prev.indexed_count - currentIndexed) / prev.indexed_count
  if (drop > 0.1) {
    const pct = Math.round(drop * 100)
    const orgId = await getOrgId(siteId)
    await createAlert(prisma, {
      siteId,
      orgId,
      rule:     'gsc.index_drop',
      severity: 'critical',
      title:    `Indexed pages dropped ${pct}%`,
      body:     `Search Console shows ${currentIndexed} indexed pages, down from ${prev.indexed_count} (−${pct}%). Urgent: check for accidental noindex, robots.txt changes, or manual actions.`,
    })
  } else {
    await resolveAlert(prisma, siteId, 'gsc.index_drop')
  }
}

async function handleRevoked(siteId: string) {
  const site = await prisma.site.findUnique({ where: { id: siteId }, select: { org_id: true } })
  if (!site) return
  await createAlert(prisma, {
    siteId,
    orgId:    site.org_id,
    rule:     'gsc.connection_revoked',
    severity: 'warning',
    title:    'Google Search Console disconnected',
    body:     'The GSC connection was revoked. Reconnect in Settings → SEO to resume traffic monitoring.',
  })
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startGscWorker() {
  return new Worker(
    'gsc',
    async job => {
      const { siteId } = job.data as { siteId: string }
      await runGscPull(siteId)
    },
    { connection: BULL_CONNECTION, concurrency: 3 },
  )
}
