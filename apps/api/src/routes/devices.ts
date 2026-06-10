import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../lib/prisma'

const deviceBody = z.object({ token: z.string().min(1) })

export default async function devicesRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // POST /v1/devices — register an Expo push token for the calling user
  fastify.post('/v1/devices', { preHandler: authenticate }, async (req, reply) => {
    const parsed = deviceBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } })
    const tokens = new Set(user.expo_push_tokens as string[])
    tokens.add(parsed.data.token)

    await prisma.user.update({
      where: { id: user.id },
      data: { expo_push_tokens: Array.from(tokens) },
    })
    return reply.send({ ok: true })
  })

  // DELETE /v1/devices/:token
  fastify.delete('/v1/devices/:token', { preHandler: authenticate }, async (req, reply) => {
    const { token } = req.params as { token: string }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.sub } })
    const tokens = (user.expo_push_tokens as string[]).filter(t => t !== token)

    await prisma.user.update({ where: { id: user.id }, data: { expo_push_tokens: tokens } })
    return reply.send({ ok: true })
  })
}
