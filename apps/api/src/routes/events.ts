import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { verifyAgentRequest } from '../lib/hmac'
import { eventsQueue } from '../lib/queue'

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
    const ts  = req.headers['x-sitewatch-timestamp']  as string | undefined
    if (!sig || !ts) return reply.status(400).send({ error: 'Missing HMAC headers' })

    const parsed = bodySchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { site_id, events } = parsed.data
    const site = await prisma.site.findUnique({ where: { id: site_id } })
    if (!site?.site_key_hash) return reply.status(401).send({ error: 'Site not found or not paired' })

    const rawBody = req.rawBody ?? JSON.stringify(req.body)
    if (!verifyAgentRequest({ siteKey: site.site_key_hash, signature: sig, body: rawBody, timestamp: ts })) {
      return reply.status(401).send({ error: 'Invalid HMAC signature' })
    }

    // ── Persist events (individual creates to capture generated IDs) ─────────
    const created = await prisma.$transaction(
      events.map(ev =>
        prisma.event.create({
          data: {
            site_id,
            type: ev.type,
            severity: ev.severity_hint,
            occurred_at: new Date(ev.occurred_at),
            actor: ev.actor ? ev.actor as Prisma.InputJsonValue : Prisma.JsonNull,
            data:  ev.data  ? ev.data  as Prisma.InputJsonValue : Prisma.JsonNull,
            ip: (ev.actor?.ip ?? ev.data?.ip) as string | null ?? null,
            geo: Prisma.JsonNull,
            correlated_event_id: null,
          },
          select: { id: true, type: true, occurred_at: true, actor: true, data: true, ip: true, geo: true },
        }),
      ),
    )

    // ── Enqueue async processing (geo enrichment + rules engine) ────────────
    await eventsQueue.add(
      'events.process',
      { siteId: site_id, eventIds: created.map(e => e.id) },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    )

    // Update last_health_at for ai.crawler_stat events
    if (events.some(e => e.type.startsWith('ai.'))) {
      await prisma.site.update({ where: { id: site_id }, data: { last_health_at: new Date() } })
    }

    return reply.send({ ok: true, stored: created.length })
  })
}
