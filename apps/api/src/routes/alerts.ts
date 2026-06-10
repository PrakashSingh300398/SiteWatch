import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

export default async function alertsRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // GET /v1/alerts?status=open|resolved|all
  fastify.get('/v1/alerts', { preHandler: authenticate }, async (req, reply) => {
    const { orgId } = req.user
    const { status = 'open' } = req.query as { status?: string }

    const resolvedFilter =
      status === 'open'
        ? { resolved_at: null }
        : status === 'resolved'
          ? { resolved_at: { not: null } }
          : {}

    const alerts = await prisma.alert.findMany({
      where: { org_id: orgId, ...resolvedFilter },
      orderBy: { created_at: 'desc' },
      take: 100,
      include: { site: { select: { id: true, name: true, url: true } } },
    })
    return reply.send({ alerts })
  })

  // POST /v1/alerts/:id/ack
  fastify.post('/v1/alerts/:id/ack', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const alert = await prisma.alert.findFirst({ where: { id, org_id: req.user.orgId } })
    if (!alert) return reply.status(404).send({ error: 'Alert not found' })

    return reply.send({
      alert: await prisma.alert.update({
        where: { id },
        data: { acknowledged_at: new Date() },
      }),
    })
  })

  // POST /v1/alerts/:id/resolve
  fastify.post('/v1/alerts/:id/resolve', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const alert = await prisma.alert.findFirst({ where: { id, org_id: req.user.orgId } })
    if (!alert) return reply.status(404).send({ error: 'Alert not found' })

    return reply.send({
      alert: await prisma.alert.update({
        where: { id },
        data: { resolved_at: new Date() },
      }),
    })
  })
}
