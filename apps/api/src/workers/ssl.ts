import { Worker } from 'bullmq'
import tls from 'node:tls'
import { prisma } from '../lib/prisma'
import { BULL_CONNECTION } from '../lib/queue'
import { createAlert, resolveAlert } from '../lib/alerts'

// ─── TLS probe ────────────────────────────────────────────────────────────────

interface SslInfo {
  expiresAt: Date
  issuer: string
  grade: string | null
}

function probeSsl(hostname: string, port = 443): Promise<SslInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate(false)
        socket.destroy()
        if (!cert?.valid_to) return reject(new Error('No certificate'))
        // Issuer fields can be string | string[] in Node TLS typings
        const pick = (v: string | string[] | undefined) =>
          Array.isArray(v) ? v[0] : v
        resolve({
          expiresAt: new Date(cert.valid_to),
          issuer: pick(cert.issuer?.O) ?? pick(cert.issuer?.CN) ?? 'Unknown',
          grade: null, // Full grading (A/B/F) requires SSL Labs API — Phase 2
        })
      },
    )
    socket.setTimeout(15_000, () => { socket.destroy(); reject(new Error('SSL probe timed out')) })
    socket.on('error', reject)
  })
}

// ─── Alert rules for SSL (spec §4.4) ─────────────────────────────────────────

type SslAlertDecision = {
  rule: string
  severity: 'critical' | 'warning'
  title: string
  body: string
} | null

function sslAlertDecision(
  siteName: string,
  hostname: string,
  expiresAt: Date,
  daysLeft: number,
): SslAlertDecision {
  const expires = expiresAt.toDateString()

  if (daysLeft <= 0) {
    return {
      rule: 'ssl.expired',
      severity: 'critical',
      title: `SSL expired: ${siteName}`,
      body: `SSL certificate for ${hostname} expired on ${expires}. Visitors see a security error.`,
    }
  }
  if (daysLeft <= 3) {
    return {
      rule: 'ssl.expiring_critical',
      severity: 'critical',
      title: `SSL expires in ${daysLeft}d: ${siteName}`,
      body: `SSL certificate for ${hostname} expires on ${expires}. Renew immediately.`,
    }
  }
  if (daysLeft <= 14) {
    return {
      rule: 'ssl.expiring_warning',
      severity: 'warning',
      title: `SSL expires in ${daysLeft}d: ${siteName}`,
      body: `SSL certificate for ${hostname} expires on ${expires}.`,
    }
  }
  return null
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startSslWorker() {
  return new Worker(
    'ssl',
    async job => {
      const { siteId } = job.data as { siteId: string }

      const site = await prisma.site.findUnique({ where: { id: siteId } })
      if (!site) return

      let hostname: string
      try {
        hostname = new URL(site.url).hostname
      } catch {
        return
      }

      let info: SslInfo
      try {
        info = await probeSsl(hostname)
      } catch {
        // Can't reach TLS — uptime worker will catch connectivity issues; skip
        return
      }

      await prisma.sslStatus.upsert({
        where: { site_id: siteId },
        create: {
          site_id: siteId,
          issuer: info.issuer,
          expires_at: info.expiresAt,
          grade: info.grade,
          last_checked_at: new Date(),
        },
        update: {
          issuer: info.issuer,
          expires_at: info.expiresAt,
          grade: info.grade,
          last_checked_at: new Date(),
        },
      })

      const daysLeft = Math.ceil(
        (info.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      )

      // Resolve any prior SSL alert if cert is now healthy
      if (daysLeft > 14) {
        await resolveAlert(prisma, siteId, 'ssl.expired')
        await resolveAlert(prisma, siteId, 'ssl.expiring_critical')
        await resolveAlert(prisma, siteId, 'ssl.expiring_warning')
        return
      }

      const decision = sslAlertDecision(site.name, hostname, info.expiresAt, daysLeft)
      if (!decision) return

      await createAlert(prisma, { siteId, orgId: site.org_id, ...decision })
    },
    { connection: BULL_CONNECTION, concurrency: 10 },
  )
}
