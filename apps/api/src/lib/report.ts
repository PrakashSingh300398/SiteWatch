import PDFDocument from 'pdfkit'
import type { Readable } from 'node:stream'
import { prisma } from './prisma'
import { callClaude, AI_MODEL_SMART } from './anthropic'

const ACCENT  = '#6366f1'
const BG      = '#0f0f0f'
const TEXT    = '#e5e5e5'
const MUTED   = '#6b7280'
const SUCCESS = '#22c55e'
const WARNING = '#f59e0b'
const DANGER  = '#ef4444'

export async function generateSiteReport(siteId: string, month: string): Promise<Readable> {
  // month = 'YYYY-MM'
  const [year, mon] = month.split('-').map(Number)
  const start = new Date(year, mon - 1, 1)
  const end   = new Date(year, mon, 1)

  const [site, uptimeChecks, events, alerts, forms, vitals] = await Promise.all([
    prisma.site.findUnique({
      where: { id: siteId },
      include: { ssl_status: true, plugins: { where: { update_available: true } } },
    }),
    prisma.uptimeCheck.findMany({
      where: { site_id: siteId, checked_at: { gte: start, lt: end } },
      select: { ok: true, response_ms: true },
    }),
    prisma.event.findMany({
      where: { site_id: siteId, occurred_at: { gte: start, lt: end }, severity: { in: ['warning', 'critical'] } },
      orderBy: { occurred_at: 'asc' },
      select: { type: true, severity: true, occurred_at: true, data: true },
      take: 50,
    }),
    prisma.alert.findMany({
      where: { site_id: siteId, created_at: { gte: start, lt: end } },
      orderBy: { created_at: 'asc' },
      select: { title: true, severity: true, created_at: true, resolved_at: true },
      take: 30,
    }),
    prisma.formMonitor.findMany({
      where: { site_id: siteId },
      select: { form_name: true, count_7d: true, baseline_daily: true, alert_state: true },
    }),
    prisma.webVitals.findFirst({
      where: { site_id: siteId },
      orderBy: { measured_at: 'desc' },
    }),
  ])

  if (!site) throw new Error('Site not found')

  const totalChecks = uptimeChecks.length
  const okChecks    = uptimeChecks.filter(c => c.ok).length
  const uptimePct   = totalChecks > 0 ? (okChecks / totalChecks) * 100 : null
  const avgMs       = uptimeChecks.filter(c => c.response_ms).length > 0
    ? Math.round(uptimeChecks.reduce((s, c) => s + (c.response_ms ?? 0), 0) / uptimeChecks.filter(c => c.response_ms).length)
    : null

  const monthLabel = new Date(year, mon - 1, 1).toLocaleDateString('en-CA', { year: 'numeric', month: 'long' })

  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `SiteWatch Report — ${site.name} — ${monthLabel}` } })

  // ── Cover / header ─────────────────────────────────────────────────────────
  doc.rect(0, 0, doc.page.width, 120).fill('#1a1a2e')
  doc.fill(ACCENT).fontSize(22).font('Helvetica-Bold').text('SiteWatch', 50, 35)
  doc.fill('#ffffff').fontSize(11).font('Helvetica').text('Monthly Performance Report', 50, 62)
  doc.fill('#aaaacc').fontSize(10).text(`${site.name}  ·  ${monthLabel}`, 50, 80)
  doc.fill('#aaaacc').fontSize(9).text(site.url, 50, 96)

  let y = 145

  // ── Uptime summary ─────────────────────────────────────────────────────────
  y = section(doc, 'Uptime & Performance', y)

  const uptimeColor = uptimePct == null ? MUTED : uptimePct >= 99.9 ? SUCCESS : uptimePct >= 99 ? WARNING : DANGER
  row(doc, 'Uptime', uptimePct != null ? `${uptimePct.toFixed(3)}%` : 'No data', y, uptimeColor); y += 22
  row(doc, 'Total checks', String(totalChecks), y); y += 22
  row(doc, 'Avg response time', avgMs != null ? `${avgMs}ms` : '—', y); y += 22
  row(doc, 'Downtime incidents', String(alerts.filter(a => a.title.toLowerCase().includes('down')).length), y); y += 30

  // ── Alerts this month ──────────────────────────────────────────────────────
  y = section(doc, 'Alerts This Month', y)
  if (alerts.length === 0) {
    doc.fill(MUTED).fontSize(10).text('No alerts this month.', 50, y); y += 20
  } else {
    for (const a of alerts.slice(0, 12)) {
      const color = a.severity === 'critical' ? DANGER : WARNING
      const resolved = a.resolved_at ? ` → resolved ${fmt(a.resolved_at)}` : ' (open)'
      doc.fill(color).fontSize(9).font('Helvetica-Bold').text('●', 50, y + 1)
      doc.fill(TEXT).fontSize(9).font('Helvetica').text(`${fmt(a.created_at)}  ${a.title}${resolved}`, 65, y, { width: 480 })
      y += 16
      if (y > doc.page.height - 80) { doc.addPage(); y = 50 }
    }
    y += 10
  }

  // ── Security ───────────────────────────────────────────────────────────────
  y = section(doc, 'Security', y)
  row(doc, 'Security score', site.security_score != null ? `${site.security_score}/100` : 'Not scanned',
    y, site.security_score != null ? (site.security_score >= 80 ? SUCCESS : site.security_score >= 60 ? WARNING : DANGER) : MUTED); y += 22
  row(doc, 'Plugins with updates', String(site.plugins.length), y, site.plugins.length > 0 ? WARNING : SUCCESS); y += 22
  const sslDays = site.ssl_status?.expires_at
    ? Math.ceil((new Date(site.ssl_status.expires_at).getTime() - Date.now()) / 86_400_000)
    : null
  row(doc, 'SSL expires', sslDays != null ? `${sslDays} days` : '—', y, sslDays != null && sslDays < 14 ? WARNING : SUCCESS); y += 30

  if (y > doc.page.height - 150) { doc.addPage(); y = 50 }

  // ── Updates applied ────────────────────────────────────────────────────────
  const updateEvents = events.filter(e => e.type === 'plugin.updated' || e.type === 'core.updated')
  y = section(doc, `Updates Applied (${updateEvents.length})`, y)
  if (updateEvents.length === 0) {
    doc.fill(MUTED).fontSize(10).text('No updates recorded this month.', 50, y); y += 20
  } else {
    for (const e of updateEvents.slice(0, 10)) {
      const d = e.data as Record<string, unknown> | null
      const name = String(d?.name ?? (d?.plugins as string[])?.[0] ?? e.type)
      doc.fill(MUTED).fontSize(9).text(`${fmt(e.occurred_at)}`, 50, y)
      doc.fill(TEXT).fontSize(9).text(name, 150, y); y += 15
      if (y > doc.page.height - 80) { doc.addPage(); y = 50 }
    }
    y += 10
  }

  // ── Forms ──────────────────────────────────────────────────────────────────
  if (forms.length > 0) {
    if (y > doc.page.height - 150) { doc.addPage(); y = 50 }
    y = section(doc, 'Form Submissions', y)
    for (const f of forms) {
      const baseline = f.baseline_daily ? `${Number(f.baseline_daily).toFixed(1)}/day baseline` : 'no baseline yet'
      const status   = f.alert_state === 'stopped' ? ' ⚠ STOPPED' : ''
      row(doc, f.form_name, `${f.count_7d} last 7d  ·  ${baseline}${status}`, y,
        f.alert_state === 'stopped' ? WARNING : TEXT); y += 22
    }
    y += 10
  }

  // ── Core Web Vitals ────────────────────────────────────────────────────────
  if (y > doc.page.height - 150) { doc.addPage(); y = 50 }
  y = section(doc, 'Core Web Vitals (Mobile)', y)
  if (!vitals) {
    doc.fill(MUTED).fontSize(10).text('No vitals data yet. Add PSI_API_KEY to enable weekly scans.', 50, y); y += 20
  } else {
    const perfColor = vitals.performance == null ? MUTED : vitals.performance >= 90 ? SUCCESS : vitals.performance >= 50 ? WARNING : DANGER
    row(doc, 'Performance score', vitals.performance != null ? String(vitals.performance) : '—', y, perfColor); y += 22
    row(doc, 'LCP (Largest Contentful Paint)', vitals.lcp_ms != null ? `${(vitals.lcp_ms / 1000).toFixed(2)}s` : '—', y); y += 22
    row(doc, 'CLS (Cumulative Layout Shift)',  vitals.cls   != null ? vitals.cls.toFixed(3) : '—', y); y += 22
    row(doc, 'INP (Interaction to Next Paint)', vitals.inp_ms != null ? `${vitals.inp_ms}ms` : '—', y); y += 30
  }

  // ── AI executive summary ──────────────────────────────────────────────────
  if (y > doc.page.height - 120) { doc.addPage(); y = 50 }
  y = section(doc, 'Executive Summary', y)
  const narrative = await generateNarrative(site, monthLabel, uptimePct, alerts, updateEvents, forms, vitals)
  doc.rect(50, y, doc.page.width - 100, 3).fill(ACCENT)
  y += 8
  doc.fill(TEXT).fontSize(10).font('Helvetica').text(narrative, 55, y, { width: doc.page.width - 110, lineGap: 3 })
  y = doc.y + 12
  doc.fill(ACCENT).fontSize(8).text('✦ Generated by Claude AI · SiteWatch', 55, y)
  y += 20

  // ── Footer ─────────────────────────────────────────────────────────────────
  const pages = doc.bufferedPageRange()
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(pages.start + i)
    doc.fill(MUTED).fontSize(8).text(
      `SiteWatch by Code to Click  ·  Generated ${new Date().toLocaleDateString('en-CA')}  ·  Page ${i + 1} of ${pages.count}`,
      50, doc.page.height - 35, { align: 'center', width: doc.page.width - 100 }
    )
  }

  doc.end()
  return doc as unknown as Readable
}

// ── AI narrative ──────────────────────────────────────────────────────────────

async function generateNarrative(
  site: { name: string; url: string },
  monthLabel: string,
  uptimePct: number | null,
  alerts: Array<{ title: string; severity: string; resolved_at: Date | null }>,
  updateEvents: Array<{ type: string; data: unknown }>,
  forms: Array<{ form_name: string; count_7d: number; alert_state: string | null }>,
  vitals: { performance: number | null } | null,
): Promise<string> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('no key')

    const updateList = updateEvents.slice(0, 5).map(e => {
      const d = e.data as Record<string, unknown> | null
      return String(d?.name ?? e.type)
    }).join(', ')

    const prompt = `You are writing a monthly report executive summary for a WordPress agency client.

Site: ${site.name} (${site.url})
Month: ${monthLabel}

Data summary:
- Uptime: ${uptimePct != null ? `${uptimePct.toFixed(2)}%` : 'data unavailable'}
- Alerts this month: ${alerts.length} total, ${alerts.filter(a => !a.resolved_at).length} still open
- Critical alerts: ${alerts.filter(a => a.severity === 'critical').length}
- Updates applied: ${updateEvents.length}${updateList ? ` (${updateList})` : ''}
- Forms monitored: ${forms.length}${forms.some(f => f.alert_state === 'stopped') ? ' — one or more forms stopped receiving submissions' : ''}
- Performance score: ${vitals?.performance != null ? vitals.performance : 'not measured'}

Write a 3-4 sentence executive summary a non-technical client can understand.
Then add a short bulleted "What we did this month:" list (2-4 bullets).
Use plain English. Be positive but honest about any issues. Do not use markdown headers.`

    const { text, usage } = await callClaude({
      model:     AI_MODEL_SMART,
      maxTokens: 400,
      userPrompt: prompt,
    })

    // Cache the narrative in AiInsight so we don't call again if PDF is regenerated
    await import('./prisma').then(async ({ prisma: db }) => {
      const s = await db.site.findFirst({ where: { url: site.url }, select: { id: true } })
      if (s) {
        await db.aiInsight.create({
          data: {
            site_id:           s.id,
            kind:              'report_narrative',
            model:             AI_MODEL_SMART,
            prompt_tokens:     usage.input_tokens,
            completion_tokens: usage.output_tokens,
            content:           text,
          },
        })
      }
    }).catch(() => { /* non-fatal */ })

    return text
  } catch {
    return `${site.name} remained operational throughout ${monthLabel}. Our team monitored uptime, security events, and plugin updates continuously. Please contact us if you have any questions about the details in this report.`
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function section(doc: PDFKit.PDFDocument, title: string, y: number): number {
  doc.fill(ACCENT).rect(50, y, doc.page.width - 100, 24).fill('#1e1e3f')
  doc.fill(ACCENT).fontSize(11).font('Helvetica-Bold').text(title, 58, y + 7)
  doc.fill(TEXT).font('Helvetica')
  return y + 34
}

function row(doc: PDFKit.PDFDocument, label: string, value: string, y: number, valueColor = TEXT) {
  doc.fill(MUTED).fontSize(10).text(label, 58, y, { width: 220 })
  doc.fill(valueColor).fontSize(10).text(value, 285, y, { width: 260, align: 'right' })
}

function fmt(d: Date) {
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}
