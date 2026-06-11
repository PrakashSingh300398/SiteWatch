import type { FastifyInstance } from 'fastify'
import type { Prisma } from '@prisma/client'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { uptimeQueue, sslQueue, healthQueue } from '../lib/queue'
import { verifyAgentRequest } from '../lib/hmac'

const PAIRING_TTL_MS = 15 * 60 * 1000 // 15 minutes

function genPairingCode(): string {
  return randomBytes(4).toString('hex').toUpperCase().slice(0, 6)
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSiteBody = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(200),
  checkIntervalSec: z.number().int().min(60).max(86400).default(300),
})

const updateSiteBody = z.object({
  name: z.string().min(1).max(200).optional(),
  checkIntervalSec: z.number().int().min(60).max(86400).optional(),
  settings: z.record(z.unknown()).optional(),
})

const pairBody = z.object({
  pairingCode: z.string().length(6),
  siteUrl: z.string().url(),
  siteKey: z.string().min(32).max(128),
})

// ─── Route plugin ─────────────────────────────────────────────────────────────

export default async function sitesRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // GET /v1/sites — includes 24h uptime % and last response time
  fastify.get('/v1/sites', { preHandler: authenticate }, async (req, reply) => {
    const since24h = new Date(Date.now() - 24 * 3_600_000)

    const [sites, recentChecks] = await Promise.all([
      prisma.site.findMany({
        where: { org_id: req.user.orgId },
        include: {
          ssl_status: { select: { expires_at: true, grade: true } },
          alerts: { where: { resolved_at: null }, select: { severity: true } },
          plugins: { where: { update_available: true }, select: { id: true } },
        },
        orderBy: { created_at: 'asc' },
      }),
      prisma.uptimeCheck.findMany({
        where: {
          site: { org_id: req.user.orgId },
          checked_at: { gte: since24h },
        },
        select: { site_id: true, ok: true, response_ms: true },
        orderBy: { checked_at: 'desc' },
      }),
    ])

    // Aggregate uptime stats per site (first result per site = latest check)
    const statsMap = new Map<string, { total: number; ok: number; lastMs: number | null }>()
    for (const c of recentChecks) {
      if (!statsMap.has(c.site_id)) {
        statsMap.set(c.site_id, { total: 0, ok: 0, lastMs: c.response_ms })
      }
      const s = statsMap.get(c.site_id)!
      s.total++
      if (c.ok) s.ok++
    }

    const enriched = sites.map(site => {
      const st = statsMap.get(site.id)
      return {
        ...site,
        uptime_pct_24h: st && st.total > 0 ? Math.round((st.ok / st.total) * 1000) / 10 : null,
        last_response_ms: st?.lastMs ?? null,
      }
    })

    return reply.send({ sites: enriched })
  })

  // POST /v1/sites — generates pairing code, returns it to the app
  fastify.post('/v1/sites', { preHandler: authenticate }, async (req, reply) => {
    const parsed = createSiteBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { url, name, checkIntervalSec } = parsed.data
    const pairingCode = genPairingCode()
    const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString()

    const site = await prisma.site.create({
      data: {
        org_id: req.user.orgId,
        url,
        name,
        check_interval_sec: checkIntervalSec,
        settings: { pairing_code: pairingCode, pairing_expires_at: pairingExpiresAt },
      },
    })
    return reply.status(201).send({ site, pairingCode })
  })

  // GET /v1/sites/:id — includes full plugin list for site detail screen
  fastify.get('/v1/sites/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({
      where: { id, org_id: req.user.orgId },
      include: {
        ssl_status: true,
        plugins: { orderBy: { name: 'asc' } },
      },
    })
    if (!site) return reply.status(404).send({ error: 'Site not found' })
    return reply.send({ site })
  })

  // PATCH /v1/sites/:id
  fastify.patch('/v1/sites/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = updateSiteBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const existing = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId } })
    if (!existing) return reply.status(404).send({ error: 'Site not found' })

    const site = await prisma.site.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.checkIntervalSec !== undefined && {
          check_interval_sec: parsed.data.checkIntervalSec,
        }),
        ...(parsed.data.settings !== undefined && {
          settings: parsed.data.settings as Prisma.InputJsonValue,
        }),
      },
    })
    return reply.send({ site })
  })

  // DELETE /v1/sites/:id
  fastify.delete('/v1/sites/:id', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId } })
    if (!existing) return reply.status(404).send({ error: 'Site not found' })
    await prisma.site.delete({ where: { id } })
    return reply.status(204).send()
  })

  // GET /v1/sites/:id/uptime?range=24h|7d|30d
  fastify.get('/v1/sites/:id/uptime', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { range = '24h' } = req.query as { range?: string }

    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId } })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    const hours: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }
    const since = new Date(Date.now() - (hours[range] ?? 24) * 3_600_000)

    const checks = await prisma.uptimeCheck.findMany({
      where: { site_id: id, checked_at: { gte: since } },
      orderBy: { checked_at: 'asc' },
      select: { checked_at: true, ok: true, response_ms: true, status_code: true },
    })

    const ok = checks.filter(c => c.ok).length
    return reply.send({
      checks,
      uptimePct: checks.length > 0 ? (ok / checks.length) * 100 : null,
    })
  })

  // GET /v1/sites/:id/events — security timeline with cursor pagination
  fastify.get('/v1/sites/:id/events', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const { limit = '50', before, severity } = req.query as {
      limit?: string; before?: string; severity?: string
    }

    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId } })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    const severityFilter = severity
      ? { severity: { in: severity.split(',') as ('info' | 'warning' | 'critical')[] } }
      : {}
    const cursorFilter = before ? { occurred_at: { lt: new Date(before) } } : {}
    const take = Math.min(parseInt(limit, 10) || 50, 200)

    const events = await prisma.event.findMany({
      where: { site_id: id, ...severityFilter, ...cursorFilter },
      orderBy: { occurred_at: 'desc' },
      take: take + 1,
      select: {
        id: true, type: true, severity: true, occurred_at: true,
        actor: true, data: true, ip: true, geo: true,
        correlated_event_id: true,
        alerts: { select: { id: true, rule: true } },
      },
    })

    const hasMore = events.length > take
    const page = events.slice(0, take)
    const nextCursor = hasMore ? page[page.length - 1].occurred_at.toISOString() : null

    return reply.send({ events: page, nextCursor })
  })

  // ─── Agent endpoints (HMAC auth, no JWT) ────────────────────────────────────

  // POST /v1/sites/pair — called by the WP plugin during setup
  fastify.post('/v1/sites/pair', async (req, reply) => {
    const parsed = pairBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { pairingCode, siteUrl, siteKey } = parsed.data

    // Find site with matching pairing code (Prisma JSON path filter)
    const sites = await prisma.site.findMany({
      where: { settings: { path: ['pairing_code'], equals: pairingCode } },
    })
    if (sites.length === 0) return reply.status(404).send({ error: 'Invalid pairing code' })
    const site = sites[0]

    const settings = site.settings as Record<string, string>
    if (Date.now() > new Date(settings.pairing_expires_at).getTime()) {
      return reply.status(410).send({ error: 'Pairing code expired' })
    }
    if (site.paired_at) return reply.status(409).send({ error: 'Site already paired' })

    // Store raw site key (Phase 1). Phase 2: encrypt with AES-256-GCM before storing.
    await prisma.site.update({
      where: { id: site.id },
      data: {
        url: siteUrl,
        site_key_hash: siteKey,
        paired_at: new Date(),
        status: 'unknown',
        settings: {}, // clear pairing code
      },
    })

    // Kick off first checks immediately
    await uptimeQueue.add('uptime.check', { siteId: site.id }, { jobId: `uptime:${site.id}:init` })
    await sslQueue.add('ssl.check', { siteId: site.id }, { jobId: `ssl:${site.id}:init` })

    return reply.send({ siteId: site.id, ok: true })
  })

  // POST /v1/health — agent pushes health snapshot (HMAC required)
  fastify.post('/v1/health', {
    config: { rawBody: true },
  }, async (req, reply) => {
    const siteId = req.headers['x-sitewatch-site-id'] as string
    const sig = req.headers['x-sitewatch-signature'] as string
    const ts = req.headers['x-sitewatch-timestamp'] as string
    if (!siteId || !sig || !ts) return reply.status(400).send({ error: 'Missing agent headers' })

    const site = await prisma.site.findUnique({ where: { id: siteId } })
    if (!site?.site_key_hash) return reply.status(401).send({ error: 'Site not paired' })

    const rawBody = req.rawBody ?? JSON.stringify(req.body)
    if (!verifyAgentRequest({ siteKey: site.site_key_hash, signature: sig, body: rawBody, timestamp: ts })) {
      return reply.status(401).send({ error: 'Invalid HMAC signature' })
    }

    // Health snapshot processing is handled in step 4 (health.pull worker).
    // For now: record timestamp and return OK so the agent knows we received it.
    await prisma.site.update({ where: { id: siteId }, data: { last_health_at: new Date() } })
    return reply.send({ ok: true })
  })

  // POST /v1/sites/:id/sync — force immediate health pull
  fastify.post('/v1/sites/:id/sync', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true, paired_at: true } })
    if (!site) return reply.status(404).send({ error: 'Not found' })
    if (!site.paired_at) return reply.status(400).send({ error: 'Site not paired yet' })

    // Clear last_health_at so scheduler picks it up, and enqueue directly
    await prisma.site.update({ where: { id }, data: { last_health_at: null } })
    await healthQueue.add('health.pull', { siteId: id }, { jobId: `health:${id}:manual:${Date.now()}` })
    return reply.send({ ok: true, message: 'Health pull queued' })
  })

  // GET /v1/sites/:id/forms
  fastify.get('/v1/sites/:id/forms', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true } })
    if (!site) return reply.status(404).send({ error: 'Not found' })

    const forms = await prisma.formMonitor.findMany({
      where: { site_id: id },
      orderBy: { form_name: 'asc' },
      select: {
        id: true,
        form_plugin: true,
        form_id: true,
        form_name: true,
        count_24h: true,
        count_7d: true,
        last_entry_at: true,
        baseline_daily: true,
        alert_state: true,
      },
    })
    return reply.send(forms)
  })

  // GET /v1/sites/:id/users — elevated WP users from last health pull
  fastify.get('/v1/sites/:id/users', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({
      where: { id, org_id: req.user.orgId },
      select: { wp_users: true },
    })
    if (!site) return reply.status(404).send({ error: 'Not found' })
    return reply.send(site.wp_users ?? [])
  })

  // GET /v1/sites/:id/vitals
  fastify.get('/v1/sites/:id/vitals', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true } })
    if (!site) return reply.status(404).send({ error: 'Not found' })

    const vitals = await prisma.webVitals.findMany({
      where: { site_id: id },
      orderBy: { measured_at: 'desc' },
      take: 10,
      select: {
        id: true,
        performance: true,
        lcp_ms: true,
        cls: true,
        inp_ms: true,
        strategy: true,
        measured_at: true,
      },
    })
    return reply.send(vitals)
  })
}
