import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

export default async function dashboardRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // GET /v1/dashboard — aggregate snapshot for the home screen
  fastify.get('/v1/dashboard', { preHandler: authenticate }, async (req, reply) => {
    const { orgId } = req.user
    const SSL_WARN_MS = 14 * 24 * 3_600_000

    const [sites, alertCounts, sslExpiring, updatesPending] = await Promise.all([
      prisma.site.findMany({
        where: { org_id: orgId },
        select: { status: true, security_score: true },
      }),
      prisma.alert.groupBy({
        by: ['severity'],
        where: { org_id: orgId, resolved_at: null },
        _count: { _all: true },
      }),
      prisma.sslStatus.count({
        where: {
          expires_at: { lte: new Date(Date.now() + SSL_WARN_MS) },
          site: { org_id: orgId },
        },
      }),
      prisma.plugin.count({
        where: { update_available: true, site: { org_id: orgId } },
      }),
    ])

    const statusCounts = { up: 0, down: 0, unknown: 0 }
    for (const s of sites) statusCounts[s.status]++

    const openAlerts = Object.fromEntries(
      alertCounts.map(g => [g.severity, g._count._all]),
    ) as Record<string, number>

    return reply.send({
      sites: { total: sites.length, ...statusCounts },
      alerts: { open: openAlerts },
      ssl: { expiringSoon: sslExpiring },
      updates: { pending: updatesPending },
    })
  })
}
