import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

async function fetchLlmsTxt(siteUrl: string): Promise<boolean> {
  try {
    const url = siteUrl.replace(/\/$/, '') + '/llms.txt'
    const resp = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5_000),
    })
    return resp.ok
  } catch {
    return false
  }
}

async function computeReadinessScore(siteId: string, siteUrl: string): Promise<{
  score: number
  breakdown: Record<string, { earned: number; max: number; label: string }>
}> {
  const [auditSummary, crawlPages, crawlerStats] = await Promise.all([
    prisma.seoAuditSummary.findFirst({
      where: { site_id: siteId },
      orderBy: { crawled_at: 'desc' },
      select: { issue_counts: true },
    }),
    prisma.crawlPage.findMany({
      where: { site_id: siteId },
      select: { issues: true },
      take: 100,
    }),
    prisma.aiCrawlerStat.findMany({
      where: { site_id: siteId, date: { gte: new Date(Date.now() - 30 * 86_400_000) } },
      select: { hits: true, bot: true },
    }),
  ])

  const issueCounts = (auditSummary?.issue_counts ?? {}) as Record<string, number>

  // Sitemap present
  const hasSitemap = !issueCounts['missing_sitemap']

  // JSON-LD coverage (% of crawled pages with JSON-LD)
  // We detect this from absence of issues — pages without JSON-LD don't get flagged currently
  // Use a proxy: check if crawl pages exist and score > 60
  const hasCrawlData = crawlPages.length > 0

  // AI bots not blocked in robots.txt (no robots-blocking issue found in crawl)
  const robotsBlocking = crawlPages.some(p => (p.issues as string[]).includes('noindex'))
  const aiBotsAllowed = !robotsBlocking

  // Has AI crawler traffic in last 30 days
  const hasAiTraffic = crawlerStats.length > 0 && crawlerStats.reduce((s, r) => s + r.hits, 0) > 0

  // llms.txt
  const hasLlmsTxt = await fetchLlmsTxt(siteUrl)

  const breakdown = {
    sitemap:     { earned: hasSitemap    ? 20 : 0, max: 20, label: 'Valid sitemap' },
    structured_data: { earned: hasCrawlData ? 20 : 0, max: 20, label: 'Crawl data available' },
    ai_bots_allowed: { earned: aiBotsAllowed ? 25 : 0, max: 25, label: 'AI bots not blocked' },
    ai_traffic:  { earned: hasAiTraffic  ? 15 : 0, max: 15, label: 'AI crawler traffic detected' },
    llms_txt:    { earned: hasLlmsTxt    ? 20 : 0, max: 20, label: 'llms.txt present' },
  }

  const score = Object.values(breakdown).reduce((s, b) => s + b.earned, 0)
  return { score, breakdown }
}

export default async function aiRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // GET /v1/sites/:id/ai — AI readiness score + crawler stats + referral data
  fastify.get('/v1/sites/:id/ai', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({
      where: { id, org_id: req.user.orgId },
      select: { id: true, url: true },
    })
    if (!site) return reply.status(404).send({ error: 'Not found' })

    const since30d = new Date(Date.now() - 30 * 86_400_000)

    const [crawlerStats, referralStats, readiness] = await Promise.all([
      prisma.aiCrawlerStat.findMany({
        where: { site_id: id, date: { gte: since30d } },
        orderBy: { date: 'asc' },
        select: { date: true, bot: true, hits: true, sample_paths: true },
      }),
      prisma.aiReferralDaily.findMany({
        where: { site_id: id, date: { gte: since30d } },
        orderBy: { date: 'asc' },
        select: { date: true, source: true, sessions: true },
      }),
      computeReadinessScore(id, site.url),
    ])

    // Aggregate crawler hits by bot
    const botTotals: Record<string, number> = {}
    for (const s of crawlerStats) {
      botTotals[s.bot] = (botTotals[s.bot] ?? 0) + s.hits
    }

    // Aggregate referral sessions by source
    const sourceTotals: Record<string, number> = {}
    for (const s of referralStats) {
      sourceTotals[s.source] = (sourceTotals[s.source] ?? 0) + s.sessions
    }

    return reply.send({
      readiness,
      crawlerStats,
      botTotals,
      referralStats,
      sourceTotals,
    })
  })

  // GET /v1/sites/:id/ai/insights — AI briefs for an alert or recent
  fastify.get('/v1/sites/:id/ai/insights', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { alertId } = req.query as { alertId?: string }

    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true } })
    if (!site) return reply.status(404).send({ error: 'Not found' })

    const insights = await prisma.aiInsight.findMany({
      where: {
        site_id: id,
        ...(alertId ? { alert_id: alertId } : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 20,
      select: { id: true, alert_id: true, kind: true, model: true, content: true, created_at: true, prompt_tokens: true, completion_tokens: true },
    })

    return reply.send({ insights })
  })
}
