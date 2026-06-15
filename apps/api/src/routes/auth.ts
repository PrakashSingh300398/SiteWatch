import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { redis } from '../lib/redis'
import { sendResetEmail } from '../lib/email'

const REFRESH_TTL_SEC = 30 * 24 * 60 * 60 // 30 days

// ─── Schemas ──────────────────────────────────────────────────────────────────

const registerBody = z.object({
  orgName: z.string().min(2).max(100).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  inviteToken: z.string().uuid().optional(),
})

const loginBody = z.object({
  email: z.string().email(),
  password: z.string(),
})

const refreshBody = z.object({
  refreshToken: z.string(),
})

const forgotBody = z.object({
  email: z.string().email(),
})

const resetBody = z.object({
  token: z.string().uuid(),
  password: z.string().min(8).max(100),
})

// ─── Token helpers ────────────────────────────────────────────────────────────

function issueAccessToken(userId: string, orgId: string, role: string): string {
  return jwt.sign({ sub: userId, orgId, role }, process.env.JWT_SECRET!, {
    expiresIn: '15m',
  })
}

function issueRefreshToken(userId: string, jti: string): string {
  return jwt.sign({ sub: userId, jti }, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: '30d',
  })
}

async function saveRefresh(userId: string, jti: string) {
  await redis.set(`refresh:${userId}:${jti}`, '1', 'EX', REFRESH_TTL_SEC)
}

async function revokeRefresh(userId: string, jti: string) {
  await redis.del(`refresh:${userId}:${jti}`)
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /v1/auth/register
  fastify.post('/v1/auth/register', async (req, reply) => {
    const parsed = registerBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { orgName, email, password, inviteToken } = parsed.data

    const taken = await prisma.user.findUnique({ where: { email } })
    if (taken) return reply.status(409).send({ error: 'Email already registered' })

    const password_hash = await bcrypt.hash(password, 12)

    let orgId: string
    let role: 'owner' | 'member' = 'owner'

    if (inviteToken) {
      const invitation = await prisma.invitation.findUnique({
        where: { token: inviteToken },
        include: { org: { select: { id: true } } },
      })
      if (!invitation) return reply.status(404).send({ error: 'Invite not found' })
      if (invitation.accepted_at) return reply.status(410).send({ error: 'Invite already used' })
      if (invitation.expires_at < new Date()) return reply.status(410).send({ error: 'Invite expired' })
      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        return reply.status(403).send({ error: 'Invite email does not match' })
      }
      orgId = invitation.org.id
      role = invitation.role as 'owner' | 'member'
      await prisma.invitation.update({ where: { id: invitation.id }, data: { accepted_at: new Date() } })
    } else {
      if (!orgName) return reply.status(400).send({ error: 'orgName required when registering without invite' })
      const org = await prisma.organization.create({ data: { name: orgName } })
      orgId = org.id
    }

    const user = await prisma.user.create({
      data: { org_id: orgId, email, password_hash, role },
    })

    const jti = randomUUID()
    const accessToken = issueAccessToken(user.id, user.org_id, user.role)
    const refreshToken = issueRefreshToken(user.id, jti)
    await saveRefresh(user.id, jti)

    return reply.status(201).send({
      accessToken,
      refreshToken,
      user: { id: user.id, email, role: user.role, orgId: user.org_id },
    })
  })

  // POST /v1/auth/login
  fastify.post('/v1/auth/login', async (req, reply) => {
    const parsed = loginBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { email, password } = parsed.data
    const user = await prisma.user.findUnique({ where: { email } })

    // Constant-time path: always hash-compare even on miss to prevent timing attacks
    const hash = user?.password_hash ?? '$2a$12$invalidhashinvalidhashinvalidhashinvalidhas'
    const valid = await bcrypt.compare(password, hash)
    if (!user || !valid) return reply.status(401).send({ error: 'Invalid credentials' })

    const jti = randomUUID()
    const accessToken = issueAccessToken(user.id, user.org_id, user.role)
    const refreshToken = issueRefreshToken(user.id, jti)
    await saveRefresh(user.id, jti)

    return reply.send({
      accessToken,
      refreshToken,
      user: { id: user.id, email, role: user.role, orgId: user.org_id },
    })
  })

  // POST /v1/auth/forgot-password
  fastify.post('/v1/auth/forgot-password', async (req, reply) => {
    const parsed = forgotBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    // Always return 200 to prevent email enumeration
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })
    if (user) {
      const token = randomUUID()
      await redis.set(`pwd-reset:${token}`, user.id, 'EX', 3600) // 1 hour
      await sendResetEmail(user.email, token)
    }
    return reply.send({ message: 'If that email exists, a reset link has been sent.' })
  })

  // POST /v1/auth/reset-password
  fastify.post('/v1/auth/reset-password', async (req, reply) => {
    const parsed = resetBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { token, password } = parsed.data
    const userId = await redis.get(`pwd-reset:${token}`)
    if (!userId) return reply.status(400).send({ error: 'Reset token is invalid or expired' })

    const password_hash = await bcrypt.hash(password, 12)
    await prisma.user.update({ where: { id: userId }, data: { password_hash } })
    await redis.del(`pwd-reset:${token}`)

    return reply.send({ message: 'Password updated. Please sign in.' })
  })

  // POST /v1/auth/refresh — rotating refresh tokens
  fastify.post('/v1/auth/refresh', async (req, reply) => {
    const parsed = refreshBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    let payload: { sub: string; jti: string }
    try {
      payload = jwt.verify(parsed.data.refreshToken, process.env.JWT_REFRESH_SECRET!) as {
        sub: string
        jti: string
      }
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' })
    }

    const stored = await redis.get(`refresh:${payload.sub}:${payload.jti}`)
    if (!stored) return reply.status(401).send({ error: 'Refresh token revoked' })

    const user = await prisma.user.findUnique({ where: { id: payload.sub } })
    if (!user) return reply.status(401).send({ error: 'User not found' })

    // Rotate: revoke old, issue new
    await revokeRefresh(payload.sub, payload.jti)
    const newJti = randomUUID()
    const accessToken = issueAccessToken(user.id, user.org_id, user.role)
    const refreshToken = issueRefreshToken(user.id, newJti)
    await saveRefresh(user.id, newJti)

    return reply.send({ accessToken, refreshToken })
  })
}
