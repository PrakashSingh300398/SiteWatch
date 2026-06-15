import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

export interface NotifPrefs {
  push_critical: boolean
  push_warning:  boolean
  push_info:     boolean
  quiet_start:   number | null  // hour 0-23 in quiet_tz; null = disabled
  quiet_end:     number | null
  quiet_tz:      string
}

export const DEFAULT_PREFS: NotifPrefs = {
  push_critical: true,
  push_warning:  true,
  push_info:     false,
  quiet_start:   null,
  quiet_end:     null,
  quiet_tz:      'UTC',
}

const prefsBody = z.object({
  push_critical: z.boolean().optional(),
  push_warning:  z.boolean().optional(),
  push_info:     z.boolean().optional(),
  quiet_start:   z.number().int().min(0).max(23).nullable().optional(),
  quiet_end:     z.number().int().min(0).max(23).nullable().optional(),
  quiet_tz:      z.string().max(64).optional(),
})

export default async function notificationsRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // GET /v1/notifications/prefs
  fastify.get('/v1/notifications/prefs', { preHandler: authenticate }, async (req, reply) => {
    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: { notif_prefs: true },
    })
    const prefs = { ...DEFAULT_PREFS, ...(org?.notif_prefs as Partial<NotifPrefs> ?? {}) }
    return reply.send({ prefs })
  })

  // PATCH /v1/notifications/prefs — owner only
  fastify.patch('/v1/notifications/prefs', { preHandler: authenticate }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.status(403).send({ error: 'Owner only' })

    const parsed = prefsBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const org = await prisma.organization.findUnique({
      where: { id: req.user.orgId },
      select: { notif_prefs: true },
    })
    const current = { ...DEFAULT_PREFS, ...(org?.notif_prefs as Partial<NotifPrefs> ?? {}) }
    const updated: NotifPrefs = { ...current, ...parsed.data }

    await prisma.organization.update({
      where: { id: req.user.orgId },
      data: { notif_prefs: updated as object },
    })
    return reply.send({ prefs: updated })
  })
}
