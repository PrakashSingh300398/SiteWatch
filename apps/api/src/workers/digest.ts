import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { BULL_CONNECTION } from '../lib/queue'
import { sendEmail } from '../lib/email'
import { sendPushToOrg } from '../lib/push'

export function startDigestWorker() {
  return new Worker(
    'digest',
    async job => {
      if (job.name === 'digest.daily') await runDigest(job.data.orgId as string)
    },
    { connection: BULL_CONNECTION, concurrency: 5 },
  )
}

async function runDigest(orgId: string) {
  const since = new Date(Date.now() - 24 * 3600 * 1000)

  const [org, sites, openAlerts, recentInfoEvents] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true },
    }),
    prisma.site.findMany({
      where: { org_id: orgId, paired_at: { not: null } },
      select: { id: true, name: true, status: true },
    }),
    prisma.alert.findMany({
      where: {
        org_id: orgId,
        resolved_at: null,
        severity: { in: ['warning', 'info'] },
      },
      select: { title: true, severity: true, created_at: true, site: { select: { name: true } } },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    prisma.event.findMany({
      where: {
        site: { org_id: orgId },
        severity: 'info',
        occurred_at: { gte: since },
      },
      select: { type: true, occurred_at: true, site: { select: { name: true } } },
      orderBy: { occurred_at: 'desc' },
      take: 30,
    }),
  ])

  if (!org) return

  // Mark digest sent
  await prisma.organization.update({
    where: { id: orgId },
    data: { last_digest_at: new Date() },
  })

  const sitesUp   = sites.filter(s => s.status === 'up').length
  const sitesDown = sites.filter(s => s.status === 'down').length

  if (openAlerts.length === 0 && recentInfoEvents.length === 0) return

  const users = await prisma.user.findMany({
    where: { org_id: orgId },
    select: { email: true },
  })

  const html = buildDigestHtml({ org, sites, sitesUp, sitesDown, openAlerts, recentInfoEvents })
  const subject = `SiteWatch Daily Digest — ${new Date().toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`
  const pushBody = buildPushBody({ sitesUp, sitesDown, openAlerts, recentInfoEvents })

  await Promise.all([
    ...users.map(u => sendEmail({ to: u.email, subject, html })),
    sendPushToOrg(prisma, orgId, subject, pushBody),
  ])

  console.log(`[digest.daily] org=${orgId} sent to ${users.length} users`)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type OpenAlert = { title: string; severity: string; created_at: Date; site: { name: string } | null }
type InfoEvent = { type: string; occurred_at: Date; site: { name: string } | null }

function buildPushBody(args: {
  sitesUp: number
  sitesDown: number
  openAlerts: OpenAlert[]
  recentInfoEvents: InfoEvent[]
}) {
  const { sitesUp, sitesDown, openAlerts, recentInfoEvents } = args
  const parts: string[] = [`${sitesUp} up${sitesDown > 0 ? `, ${sitesDown} DOWN` : ''}`]
  if (openAlerts.length > 0) parts.push(`${openAlerts.length} open alerts`)
  if (recentInfoEvents.length > 0) parts.push(`${recentInfoEvents.length} events in 24h`)
  return parts.join(' · ')
}

function buildDigestHtml(args: {
  org: { name: string }
  sites: Array<{ name: string; status: string }>
  sitesUp: number
  sitesDown: number
  openAlerts: OpenAlert[]
  recentInfoEvents: InfoEvent[]
}) {
  const { org, sitesUp, sitesDown, openAlerts, recentInfoEvents } = args

  const alertRows = openAlerts.map(a =>
    `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #2d2d2d;">${esc(a.site?.name ?? '—')}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #2d2d2d;color:${a.severity === 'warning' ? '#f59e0b' : '#6b7280'};">${a.severity}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #2d2d2d;">${esc(a.title)}</td>
    </tr>`,
  ).join('')

  const eventRows = recentInfoEvents.slice(0, 10).map(e =>
    `<tr>
      <td style="padding:4px 8px;border-bottom:1px solid #2d2d2d;">${esc(e.site?.name ?? '—')}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #2d2d2d;">${esc(e.type)}</td>
      <td style="padding:4px 8px;border-bottom:1px solid #2d2d2d;color:#6b7280;">${e.occurred_at.toLocaleString()}</td>
    </tr>`,
  ).join('')

  return `<!DOCTYPE html>
<html>
<body style="background:#0f0f0f;color:#e5e5e5;font-family:system-ui,sans-serif;padding:24px;max-width:640px;margin:0 auto;">
  <h2 style="color:#e5e5e5;margin-bottom:4px;">SiteWatch Daily Digest</h2>
  <p style="color:#6b7280;margin-top:0;">${org.name} · ${new Date().toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>

  <div style="display:flex;gap:16px;margin:20px 0;">
    <div style="background:#1a1a1a;border-radius:8px;padding:16px 24px;flex:1;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#22c55e;">${sitesUp}</div>
      <div style="color:#6b7280;font-size:12px;">Sites Up</div>
    </div>
    ${sitesDown > 0 ? `<div style="background:#1a1a1a;border-radius:8px;padding:16px 24px;flex:1;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#ef4444;">${sitesDown}</div>
      <div style="color:#6b7280;font-size:12px;">Sites Down</div>
    </div>` : ''}
    <div style="background:#1a1a1a;border-radius:8px;padding:16px 24px;flex:1;text-align:center;">
      <div style="font-size:28px;font-weight:700;color:#f59e0b;">${openAlerts.length}</div>
      <div style="color:#6b7280;font-size:12px;">Open Alerts</div>
    </div>
  </div>

  ${openAlerts.length > 0 ? `
  <h3 style="color:#e5e5e5;font-size:14px;margin-bottom:8px;">Open Alerts</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
    <thead><tr>
      <th style="text-align:left;padding:4px 8px;color:#6b7280;font-weight:500;">Site</th>
      <th style="text-align:left;padding:4px 8px;color:#6b7280;font-weight:500;">Severity</th>
      <th style="text-align:left;padding:4px 8px;color:#6b7280;font-weight:500;">Alert</th>
    </tr></thead>
    <tbody>${alertRows}</tbody>
  </table>` : ''}

  ${eventRows ? `
  <h3 style="color:#e5e5e5;font-size:14px;margin-bottom:8px;">Recent Activity (last 24h)</h3>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr>
      <th style="text-align:left;padding:4px 8px;color:#6b7280;font-weight:500;">Site</th>
      <th style="text-align:left;padding:4px 8px;color:#6b7280;font-weight:500;">Event</th>
      <th style="text-align:left;padding:4px 8px;color:#6b7280;font-weight:500;">Time</th>
    </tr></thead>
    <tbody>${eventRows}</tbody>
  </table>` : ''}

  <p style="color:#6b7280;font-size:11px;margin-top:32px;border-top:1px solid #2d2d2d;padding-top:16px;">
    SiteWatch · Monitoring by Code to Click, Calgary AB
  </p>
</body>
</html>`
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
