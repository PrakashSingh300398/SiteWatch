import { Worker } from 'bullmq'
import * as cheerio from 'cheerio'
import { prisma } from '../lib/prisma'
import { createAlert, resolveAlert } from '../lib/alerts'
import { BULL_CONNECTION } from '../lib/queue'

const USER_AGENT = 'SiteWatchBot/1.0 (+https://sitewatch.app/bot)'
const CRAWL_LIMIT = 100
const REQ_TIMEOUT_MS = 15_000

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<{ status: number; html: string | null; finalUrl: string; redirectCount: number }> {
  let current = url
  let redirectCount = 0

  while (redirectCount < 5) {
    const resp = await fetch(current, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    })

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location')
      if (!loc) break
      current = new URL(loc, current).toString()
      redirectCount++
      continue
    }

    const contentType = resp.headers.get('content-type') ?? ''
    const html = contentType.includes('html') ? await resp.text() : null
    return { status: resp.status, html, finalUrl: current, redirectCount }
  }

  return { status: 0, html: null, finalUrl: current, redirectCount }
}

async function headCheck(url: string): Promise<{ status: number; redirectCount: number }> {
  try {
    let current = url
    let redirectCount = 0
    while (redirectCount < 5) {
      const resp = await fetch(current, {
        method: 'HEAD',
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'manual',
        signal: AbortSignal.timeout(8_000),
      })
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get('location')
        if (!loc) break
        current = new URL(loc, current).toString()
        redirectCount++
        continue
      }
      return { status: resp.status, redirectCount }
    }
    return { status: 0, redirectCount: 5 }
  } catch {
    return { status: 0, redirectCount: 0 }
  }
}

// ─── Sitemap parsing ──────────────────────────────────────────────────────────

async function fetchSitemapUrls(siteUrl: string): Promise<string[]> {
  const base = siteUrl.replace(/\/$/, '')
  const candidates = [
    `${base}/sitemap.xml`,
    `${base}/sitemap_index.xml`,
    `${base}/wp-sitemap.xml`,
    `${base}/sitemap-index.xml`,
  ]

  for (const candidate of candidates) {
    try {
      const resp = await fetch(candidate, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
      })
      if (!resp.ok) continue
      const xml = await resp.text()
      const urls = parseSitemapXml(xml, base)
      if (urls.length > 0) return urls.slice(0, CRAWL_LIMIT)
    } catch {
      continue
    }
  }
  return []
}

function parseSitemapXml(xml: string, base: string): string[] {
  // Handle sitemap index (nested sitemaps) — just extract loc from any level
  const locs = [...xml.matchAll(/<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi)]
    .map(m => m[1].trim())

  // If locs look like sub-sitemaps (end in .xml), try to fetch the first few
  // For simplicity: filter to only HTML-likely URLs (no .xml extension)
  const pageUrls = locs.filter(u => !u.endsWith('.xml') && !u.includes('sitemap'))
  if (pageUrls.length > 0) return pageUrls

  // All URLs were sub-sitemaps — return the locs as-is so caller can detect
  return locs
}

// ─── Page analysis ────────────────────────────────────────────────────────────

interface PageData {
  title: string | null
  metaDesc: string | null
  canonical: string | null
  robots: string | null
  h1: string | null
  internalLinks: string[]
  hasJsonLd: boolean
  issues: string[]
}

function analyzePage(html: string, pageUrl: string, siteOrigin: string): PageData {
  const $ = cheerio.load(html)
  const issues: string[] = []

  const title    = $('title').first().text().trim() || null
  const metaDesc = $('meta[name="description"]').attr('content')?.trim() ?? null
  const canonical= $('link[rel="canonical"]').attr('href')?.trim() ?? null
  const robots   = $('meta[name="robots"]').attr('content')?.trim() ?? null
  const h1       = $('h1').first().text().trim() || null
  const hasJsonLd= $('script[type="application/ld+json"]').length > 0

  // Issue detection
  if (!title)    issues.push('missing_title')
  else if (title.length > 60) issues.push('title_too_long')

  if (!metaDesc) issues.push('missing_meta_desc')
  else if (metaDesc.length > 160) issues.push('meta_desc_too_long')

  if (!h1) issues.push('missing_h1')

  if (robots) {
    const r = robots.toLowerCase()
    if (r.includes('noindex')) issues.push('noindex')
    if (r.includes('nofollow')) issues.push('nofollow')
  }

  if (canonical && canonical !== pageUrl && !canonical.startsWith(siteOrigin)) {
    issues.push('external_canonical')
  }

  // Internal links
  const internalLinks: string[] = []
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim()
    if (!href) return
    try {
      const abs = new URL(href, pageUrl)
      if (abs.origin === siteOrigin) {
        const clean = abs.origin + abs.pathname
        if (!internalLinks.includes(clean)) internalLinks.push(clean)
      }
    } catch { /* ignore malformed */ }
  })

  // Image alt coverage
  const imgs = $('img')
  const missingAlt = imgs.filter((_, el) => !$(el).attr('alt')).length
  if (imgs.length > 0 && missingAlt > 0) {
    issues.push(`missing_alt:${missingAlt}`)
  }

  return { title, metaDesc, canonical, robots, h1, internalLinks, hasJsonLd, issues }
}

// ─── Main crawl function ──────────────────────────────────────────────────────

export async function runSeoCrawl(siteId: string): Promise<void> {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { url: true, org_id: true },
  })
  if (!site) return

  const siteUrl   = site.url.replace(/\/$/, '')
  const siteOrigin = new URL(siteUrl).origin

  // Get previous crawl data for change detection
  const prevPages = await prisma.crawlPage.findMany({
    where: { site_id: siteId },
    select: { url: true, title: true, meta_desc: true, canonical: true, robots: true },
  })
  const prevMap = new Map(prevPages.map(p => [p.url, p]))

  // ── 1. Fetch sitemap URLs ─────────────────────────────────────────────────
  let urls = await fetchSitemapUrls(siteUrl)
  const sitemapMissing = urls.length === 0
  if (sitemapMissing) {
    // Fall back: just crawl the homepage
    urls = [siteUrl]
  }

  const issueCounts: Record<string, number> = {
    missing_title:    0,
    title_too_long:   0,
    missing_meta_desc:0,
    missing_h1:       0,
    noindex:          0,
    broken_links:     0,
    missing_sitemap:  sitemapMissing ? 1 : 0,
  }

  const crawledAt     = new Date()
  const seen          = new Set<string>()
  let sitewideNoindex = false
  let newBrokenLinks  = 0

  // Track all internal links found across pages for broken-link checking
  const allInternalLinks = new Set<string>()
  const pageDataMap = new Map<string, PageData>()

  // ── 2. Crawl pages ────────────────────────────────────────────────────────
  for (const url of urls.slice(0, CRAWL_LIMIT)) {
    if (seen.has(url)) continue
    seen.add(url)

    let pageData: PageData
    let httpStatus = 200

    try {
      const { status, html, redirectCount } = await fetchPage(url)
      httpStatus = status

      if (!html || status >= 400) {
        // Broken page
        pageData = { title: null, metaDesc: null, canonical: null, robots: null, h1: null, internalLinks: [], hasJsonLd: false, issues: [`http_${status}`] }
      } else {
        pageData = analyzePage(html, url, siteOrigin)
        if (redirectCount >= 2) pageData.issues.push('redirect_chain')
      }
    } catch {
      pageData = { title: null, metaDesc: null, canonical: null, robots: null, h1: null, internalLinks: [], hasJsonLd: false, issues: ['timeout'] }
      httpStatus = 0
    }

    // Collect internal links for broken-link check
    pageData.internalLinks.forEach(l => allInternalLinks.add(l))
    pageDataMap.set(url, pageData)

    // Tally issue counts
    for (const issue of pageData.issues) {
      const key = issue.split(':')[0]
      issueCounts[key] = (issueCounts[key] ?? 0) + 1
    }

    if (url === siteUrl || url === siteUrl + '/') {
      if (pageData.robots?.toLowerCase().includes('noindex')) {
        sitewideNoindex = true
      }
    }

    // Upsert CrawlPage
    await prisma.crawlPage.upsert({
      where: { site_id_url: { site_id: siteId, url } },
      create: {
        site_id:   siteId,
        url,
        crawled_at: crawledAt,
        title:     pageData.title,
        meta_desc: pageData.metaDesc,
        canonical: pageData.canonical,
        robots:    pageData.robots,
        h1:        pageData.h1,
        issues:    pageData.issues as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
      update: {
        crawled_at: crawledAt,
        title:     pageData.title,
        meta_desc: pageData.metaDesc,
        canonical: pageData.canonical,
        robots:    pageData.robots,
        h1:        pageData.h1,
        issues:    pageData.issues as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    })

    // ── Change detection ──────────────────────────────────────────────────
    const prev = prevMap.get(url)
    if (prev) {
      const changes: Array<{ type: string; data: Record<string, unknown> }> = []
      if (prev.title    !== pageData.title)    changes.push({ type: 'seo.title_changed',     data: { url, from: prev.title,    to: pageData.title } })
      if (prev.meta_desc !== pageData.metaDesc) changes.push({ type: 'seo.meta_changed',      data: { url, from: prev.meta_desc, to: pageData.metaDesc } })
      if (prev.canonical !== pageData.canonical) changes.push({ type: 'seo.canonical_changed', data: { url, from: prev.canonical, to: pageData.canonical } })
      if (prev.robots   !== pageData.robots)   changes.push({ type: 'seo.robots_changed',    data: { url, from: prev.robots,   to: pageData.robots } })

      for (const change of changes) {
        await prisma.event.create({
          data: {
            site_id:     siteId,
            type:        change.type,
            severity:    'info',
            occurred_at: crawledAt,
            data:        change.data as unknown as import('@prisma/client').Prisma.InputJsonValue,
          },
        })
      }
    }

    // Politeness: 1 req/sec
    await new Promise(r => setTimeout(r, 1000))
  }

  // ── 3. Broken internal link check (spot-check links not already crawled) ──
  const unchecked = [...allInternalLinks].filter(l => !seen.has(l)).slice(0, 50)
  const brokenPrev = await prisma.crawlPage.findMany({
    where: { site_id: siteId, issues: { array_contains: 'broken_link' } as never },
    select: { url: true },
  })
  const prevBrokenUrls = new Set(brokenPrev.map(p => p.url))

  for (const link of unchecked) {
    await new Promise(r => setTimeout(r, 500))
    const { status, redirectCount } = await headCheck(link)
    const isBroken = status >= 400 || status === 0
    if (isBroken) {
      issueCounts['broken_links'] = (issueCounts['broken_links'] ?? 0) + 1
      if (!prevBrokenUrls.has(link)) newBrokenLinks++

      await prisma.crawlPage.upsert({
        where: { site_id_url: { site_id: siteId, url: link } },
        create: {
          site_id:    siteId,
          url:        link,
          crawled_at: crawledAt,
          issues:     ['broken_link', `http_${status}`] as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
        update: {
          crawled_at: crawledAt,
          issues:     ['broken_link', `http_${status}`] as unknown as import('@prisma/client').Prisma.InputJsonValue,
        },
      })
    } else if (redirectCount >= 2) {
      issueCounts['redirect_chain'] = (issueCounts['redirect_chain'] ?? 0) + 1
    }
  }

  // ── 4. Score calculation ──────────────────────────────────────────────────
  const totalPages  = seen.size || 1
  const penaltyMap: Record<string, number> = {
    missing_title:    10,
    title_too_long:    3,
    missing_meta_desc: 7,
    missing_h1:        8,
    noindex:          20,
    broken_links:     12,
    missing_sitemap:  15,
    redirect_chain:    5,
    missing_alt:       2,
  }
  let penalty = 0
  for (const [issue, count] of Object.entries(issueCounts)) {
    if (count > 0) penalty += (penaltyMap[issue] ?? 3) * Math.min(count / totalPages, 1)
  }
  const score = Math.max(0, Math.round(100 - penalty))

  await prisma.seoAuditSummary.create({
    data: {
      site_id:   siteId,
      crawled_at: crawledAt,
      score,
      issue_counts: issueCounts as unknown as import('@prisma/client').Prisma.InputJsonValue,
    },
  })

  // ── 5. Alert rules ────────────────────────────────────────────────────────
  if (sitewideNoindex) {
    await createAlert(prisma, {
      siteId,
      orgId:    site.org_id,
      rule:     'seo.noindex',
      severity: 'critical',
      title:    'Sitewide noindex detected',
      body:     `The homepage has a noindex directive, preventing search engines from indexing your site. Check Settings → Reading in WordPress (Search Engine Visibility).`,
    })
  } else {
    await resolveAlert(prisma, siteId, 'seo.noindex')
  }

  if (newBrokenLinks > 5) {
    await createAlert(prisma, {
      siteId,
      orgId:    site.org_id,
      rule:     'seo.broken_links',
      severity: 'warning',
      title:    `${newBrokenLinks} new broken internal links found`,
      body:     `The weekly crawl found ${newBrokenLinks} new broken internal links (4xx responses). Fix them to avoid ranking loss.`,
    })
  } else if (newBrokenLinks === 0) {
    await resolveAlert(prisma, siteId, 'seo.broken_links')
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startCrawlWorker() {
  return new Worker(
    'seoCrawl',
    async job => {
      const { siteId } = job.data as { siteId: string }
      await runSeoCrawl(siteId)
    },
    { connection: BULL_CONNECTION, concurrency: 2 },
  )
}
