import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'
import { encrypt, decrypt } from '../lib/crypto'
import { gscQueue } from '../lib/queue'

const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
].join(' ')

function googleAuthUrl(state: string): string {
  const clientId     = process.env.GOOGLE_OAUTH_CLIENT_ID!
  const redirectUri  = process.env.GOOGLE_OAUTH_REDIRECT_URI!
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    prompt:        'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      redirect_uri:  process.env.GOOGLE_OAUTH_REDIRECT_URI!,
      grant_type:    'authorization_code',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) throw new Error(`Google token exchange failed: ${resp.status} ${await resp.text()}`)
  return resp.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      grant_type:    'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!resp.ok) {
    const body = await resp.text()
    if (body.includes('invalid_grant')) throw new Error('REVOKED')
    throw new Error(`Google refresh failed: ${resp.status}`)
  }
  const data = await resp.json() as { access_token: string }
  return data.access_token
}

export async function getGscAccessToken(siteId: string): Promise<{ accessToken: string; conn: { id: string; property_url: string } }> {
  const conn = await prisma.gscConnection.findUnique({
    where: { site_id: siteId },
    select: { id: true, refresh_token_encrypted: true, property_url: true, status: true },
  })
  if (!conn) throw new Error('GSC_NOT_CONNECTED')
  if (conn.status === 'revoked') throw new Error('REVOKED')

  const refreshToken = decrypt(conn.refresh_token_encrypted)
  try {
    const accessToken = await refreshAccessToken(refreshToken)
    return { accessToken, conn }
  } catch (err) {
    if ((err as Error).message === 'REVOKED') {
      await prisma.gscConnection.update({ where: { id: conn.id }, data: { status: 'revoked' } })
    }
    throw err
  }
}

export async function getGoogleEmail(accessToken: string): Promise<string> {
  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!resp.ok) return 'unknown@google.com'
  const data = await resp.json() as { email: string }
  return data.email ?? 'unknown@google.com'
}

export default async function gscRoutes(fastify: FastifyInstance) {
  const { authenticate } = fastify

  // GET /v1/sites/:id/gsc/connect — return OAuth URL for mobile to open in browser
  fastify.get('/v1/sites/:id/gsc/connect', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true } })
    if (!site) return reply.status(404).send({ error: 'Site not found' })

    // State encodes siteId + userId so callback can verify ownership
    const state = Buffer.from(JSON.stringify({ siteId: id, userId: req.user.sub })).toString('base64url')
    return reply.send({ url: googleAuthUrl(state) })
  })

  // GET /v1/auth/google/callback — browser redirect from Google
  fastify.get('/v1/auth/google/callback', async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string }

    const appUrl = process.env.APP_URL ?? 'https://sitewatch.app'

    if (error || !code || !state) {
      return reply.redirect(`${appUrl}/gsc-callback?error=${error ?? 'missing_code'}`)
    }

    let siteId: string
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { siteId: string }
      siteId = decoded.siteId
    } catch {
      return reply.redirect(`${appUrl}/gsc-callback?error=invalid_state`)
    }

    try {
      const tokens = await exchangeCode(code)
      const accessToken = tokens.access_token
      const refreshToken = tokens.refresh_token

      if (!refreshToken) {
        return reply.redirect(`${appUrl}/gsc-callback?error=no_refresh_token`)
      }

      // Get the property URL from GSC (list of sites user owns)
      const site = await prisma.site.findUnique({ where: { id: siteId }, select: { url: true } })
      const propertyUrl = site?.url ?? ''

      const googleEmail = await getGoogleEmail(accessToken)
      const encrypted   = encrypt(refreshToken)

      await prisma.gscConnection.upsert({
        where: { site_id: siteId },
        create: {
          site_id:                  siteId,
          google_email:             googleEmail,
          refresh_token_encrypted:  encrypted,
          property_url:             propertyUrl,
          status:                   'active',
        },
        update: {
          google_email:             googleEmail,
          refresh_token_encrypted:  encrypted,
          property_url:             propertyUrl,
          status:                   'active',
          connected_at:             new Date(),
        },
      })

      // Kick off immediate GSC pull
      await gscQueue.add('gsc.pull', { siteId }, { jobId: `gsc:${siteId}:init` })

      return reply.redirect(`${appUrl}/gsc-callback?success=1&siteId=${siteId}`)
    } catch (err) {
      console.error('[gsc-callback]', err)
      return reply.redirect(`${appUrl}/gsc-callback?error=token_exchange_failed`)
    }
  })

  // GET /v1/sites/:id/gsc — connection status
  fastify.get('/v1/sites/:id/gsc', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true } })
    if (!site) return reply.status(404).send({ error: 'Not found' })

    const conn = await prisma.gscConnection.findUnique({
      where: { site_id: id },
      select: { google_email: true, property_url: true, connected_at: true, status: true },
    })
    return reply.send({ connected: !!conn, connection: conn ?? null })
  })

  // DELETE /v1/sites/:id/gsc — disconnect
  fastify.delete('/v1/sites/:id/gsc', { preHandler: authenticate }, async (req, reply) => {
    if (req.user.role !== 'owner') return reply.status(403).send({ error: 'Owner only' })
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true } })
    if (!site) return reply.status(404).send({ error: 'Not found' })
    await prisma.gscConnection.deleteMany({ where: { site_id: id } })
    return reply.status(204).send()
  })

  // GET /v1/sites/:id/seo — traffic data for mobile
  fastify.get('/v1/sites/:id/seo', { preHandler: authenticate }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const site = await prisma.site.findFirst({ where: { id, org_id: req.user.orgId }, select: { id: true } })
    if (!site) return reply.status(404).send({ error: 'Not found' })

    const since28d = new Date(Date.now() - 28 * 86_400_000)
    const today    = new Date(); today.setUTCHours(0, 0, 0, 0)
    const last7dStart = new Date(today.getTime() - 7 * 86_400_000)
    const prev7dStart = new Date(today.getTime() - 14 * 86_400_000)

    const [conn, daily, queries, indexStatus] = await Promise.all([
      prisma.gscConnection.findUnique({
        where: { site_id: id },
        select: { google_email: true, property_url: true, status: true, connected_at: true },
      }),
      prisma.seoDaily.findMany({
        where: { site_id: id, date: { gte: since28d } },
        orderBy: { date: 'asc' },
        select: { date: true, clicks: true, impressions: true, ctr: true, avg_position: true },
      }),
      prisma.seoQuery.findMany({
        where: { site_id: id, date: { gte: last7dStart } },
        orderBy: { clicks: 'desc' },
        take: 25,
        select: { query: true, clicks: true, impressions: true, position: true, is_priority: true },
      }),
      prisma.seoIndexStatus.findFirst({
        where: { site_id: id },
        orderBy: { date: 'desc' },
        select: { date: true, indexed_count: true, excluded_noindex: true, crawled_not_indexed: true, server_errors: true },
      }),
    ])

    // WoW click totals for client display
    const last7Clicks = daily
      .filter(d => new Date(d.date) >= last7dStart)
      .reduce((s, r) => s + r.clicks, 0)
    const prev7Clicks = daily
      .filter(d => new Date(d.date) >= prev7dStart && new Date(d.date) < last7dStart)
      .reduce((s, r) => s + r.clicks, 0)
    const clicksWoW = prev7Clicks > 0 ? ((last7Clicks - prev7Clicks) / prev7Clicks) * 100 : null

    return reply.send({
      connection: conn ?? null,
      daily,
      queries,
      indexStatus,
      summary: {
        last7Clicks,
        prev7Clicks,
        clicksWoW,
      },
    })
  })
}
