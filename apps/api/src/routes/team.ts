import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { sendEmail } from '../lib/email'

const inviteBody = z.object({
  email: z.string().email(),
  role: z.enum(['member', 'owner']).default('member'),
})

const changeRoleBody = z.object({
  role: z.enum(['member', 'owner']),
})

const INVITE_TTL_DAYS = 7

export default async function teamRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // GET /v1/team — list org members + pending invitations
  fastify.get('/v1/team', { preHandler: authenticate }, async (req, reply) => {
    const [members, invitations] = await Promise.all([
      prisma.user.findMany({
        where: { org_id: req.user.orgId },
        select: { id: true, email: true, role: true, created_at: true },
        orderBy: { created_at: 'asc' },
      }),
      prisma.invitation.findMany({
        where: { org_id: req.user.orgId, accepted_at: null, expires_at: { gt: new Date() } },
        select: { id: true, email: true, role: true, created_at: true, expires_at: true, invited_by: true },
        orderBy: { created_at: 'desc' },
      }),
    ])
    return reply.send({ members, invitations })
  })

  // POST /v1/team/invite — owner sends invite email
  fastify.post('/v1/team/invite', { preHandler: authenticate }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.status(403).send({ error: 'Owner only' })

    const parsed = inviteBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { email, role } = parsed.data

    // Don't invite someone already in the org
    const existing = await prisma.user.findFirst({ where: { email, org_id: req.user.orgId } })
    if (existing) return reply.status(409).send({ error: 'User already in organisation' })

    const org = await prisma.organization.findUnique({ where: { id: req.user.orgId }, select: { name: true } })
    const inviter = await prisma.user.findUnique({ where: { id: req.user.sub }, select: { email: true } })

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000)

    // Upsert so resending replaces a stale pending invite
    const invitation = await prisma.invitation.upsert({
      where: { org_id_email: { org_id: req.user.orgId, email } },
      create: {
        org_id: req.user.orgId,
        email,
        role,
        token: randomUUID(),
        invited_by: req.user.sub,
        expires_at: expiresAt,
      },
      update: {
        role,
        token: randomUUID(),
        invited_by: req.user.sub,
        expires_at: expiresAt,
        accepted_at: null,
      },
    })

    const inviteUrl = `${process.env.APP_URL ?? 'https://sitewatch.app'}/accept-invite?token=${invitation.token}`

    await sendEmail({
      to: email,
      subject: `You've been invited to ${org?.name ?? 'SiteWatch'}`,
      html: `
        <p>Hi,</p>
        <p><strong>${inviter?.email ?? 'Your team'}</strong> has invited you to join <strong>${org?.name ?? 'SiteWatch'}</strong> as a <strong>${role}</strong>.</p>
        <p><a href="${inviteUrl}" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Accept Invitation</a></p>
        <p>This link expires in ${INVITE_TTL_DAYS} days.</p>
        <p style="color:#6b7280;font-size:12px">If you didn't expect this email, you can ignore it.</p>
      `,
    })

    return reply.status(201).send({ ok: true, email, role, expiresAt })
  })

  // DELETE /v1/team/:userId — remove member (owner only, can't remove self)
  fastify.delete('/v1/team/:userId', { preHandler: authenticate }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.status(403).send({ error: 'Owner only' })

    const { userId } = req.params as { userId: string }
    if (userId === req.user.sub) return reply.status(400).send({ error: 'Cannot remove yourself' })

    const member = await prisma.user.findFirst({ where: { id: userId, org_id: req.user.orgId } })
    if (!member) return reply.status(404).send({ error: 'Member not found' })

    await prisma.user.delete({ where: { id: userId } })
    return reply.status(204).send()
  })

  // PATCH /v1/team/:userId/role — change role (owner only)
  fastify.patch('/v1/team/:userId/role', { preHandler: authenticate }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.status(403).send({ error: 'Owner only' })

    const { userId } = req.params as { userId: string }
    const parsed = changeRoleBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const member = await prisma.user.findFirst({ where: { id: userId, org_id: req.user.orgId } })
    if (!member) return reply.status(404).send({ error: 'Member not found' })

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { role: parsed.data.role },
      select: { id: true, email: true, role: true },
    })
    return reply.send({ member: updated })
  })

  // DELETE /v1/team/invitations/:inviteId — cancel pending invitation
  fastify.delete('/v1/team/invitations/:inviteId', { preHandler: authenticate }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.status(403).send({ error: 'Owner only' })

    const { inviteId } = req.params as { inviteId: string }
    const invite = await prisma.invitation.findFirst({ where: { id: inviteId, org_id: req.user.orgId } })
    if (!invite) return reply.status(404).send({ error: 'Invitation not found' })

    await prisma.invitation.delete({ where: { id: inviteId } })
    return reply.status(204).send()
  })
}
