/**
 * POST /v1/events — agent pushes batched events to the backend (HMAC-authenticated).
 *
 * This is the ingestion stub for Phase 1 step 3 (plugin can flush without errors).
 * Step 4 adds the full rules engine: geo-enrichment, alert rules for new-admin/role-change/
 * brute-force/new-country login, security score recalculation, etc.
 */
import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { verifyAgentRequest } from '../lib/hmac'

const eventSchema = z.object({
  type: z.string().min(1).max(100),
  severity_hint: z.enum(['info', 'warning', 'critical']).default('info'),
  occurred_at: z.string().datetime({ offset: true }),
  actor: z.record(z.unknown()).optional(),
  data: z.record(z.unknown()).optional(),
  request: z.record(z.unknown()).optional(),
})

const bodySchema = z.object({
  site_id: z.string().uuid(),
  events: z.array(eventSchema).min(1).max(200),
})

export default async function eventsRoutes(fastify: FastifyInstance) {
  fastify.post('/v1/events', async (req, reply) => {
    // ── HMAC verification ────────────────────────────────────────────────────
    const sig = req.headers['x-sitewatch-signature'] as string | undefined
    const ts  = req.headers['x-sitewatch-timestamp'] as string | undefined

    if (!sig || !ts) {
      return reply.status(400).send({ error: 'Missing HMAC headers' })
    }

    // Parse + validate body first so we can look up the site key
    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { site_id, events } = parsed.data
    const site = await prisma.site.findUnique({ where: { id: site_id } })

    if (!site?.site_key_hash) {
      return reply.status(401).send({ error: 'Site not found or not paired' })
    }

    const rawBody = req.rawBody ?? JSON.stringify(req.body)
    if (!verifyAgentRequest({ siteKey: site.site_key_hash, signature: sig, body: rawBody, timestamp: ts })) {
      return reply.status(401).send({ error: 'Invalid HMAC signature' })
    }

    // ── Persist events ───────────────────────────────────────────────────────
    // Step 4 will add: geo-enrichment, alert rules, security score, push notifications.
    // For now: store all events, map severity_hint to the Prisma enum.
    await prisma.event.createMany({
      data: events.map(ev => ({
        site_id,
        type: ev.type,
        severity: ev.severity_hint,
        occurred_at: new Date(ev.occurred_at),
        actor: ev.actor ? ev.actor as Prisma.InputJsonValue : Prisma.JsonNull,
        data: ev.data ? ev.data as Prisma.InputJsonValue : Prisma.JsonNull,
        ip: (ev.actor?.ip as string | undefined) ?? null,
        geo: Prisma.JsonNull,
        correlated_event_id: null,
      })),
    })

    // Update last_health_at for ai.crawler_stat events (they count as a sync)
    if (events.some(e => e.type.startsWith('ai.'))) {
      await prisma.site.update({
        where: { id: site_id },
        data: { last_health_at: new Date() },
      })
    }

    return reply.send({ ok: true, stored: events.length })
  })
}
