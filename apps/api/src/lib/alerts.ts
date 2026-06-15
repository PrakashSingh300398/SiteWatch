import type { PrismaClient } from '@prisma/client'
import { $Enums } from '@prisma/client'
import { sendPushToOrg } from './push'
import { aiQueue } from './queue'
import { DEFAULT_PREFS, type NotifPrefs } from '../routes/notifications'

type AlertSeverity = $Enums.AlertSeverity

function isQuietHours(start: number | null, end: number | null, tz: string): boolean {
  if (start === null || end === null) return false
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(new Date())
    const hour = parseInt(hourStr, 10)
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end
  } catch {
    return false
  }
}

function shouldSendPush(severity: AlertSeverity, prefs: NotifPrefs): boolean {
  if (severity === 'critical') return prefs.push_critical  // critical always breaks quiet hours
  const enabled = severity === 'warning' ? prefs.push_warning : prefs.push_info
  if (!enabled) return false
  return !isQuietHours(prefs.quiet_start, prefs.quiet_end, prefs.quiet_tz)
}

interface CreateAlertOpts {
  siteId: string
  orgId: string
  rule: string
  severity: AlertSeverity
  title: string
  body: string
  eventId?: string
}

export async function createAlert(db: PrismaClient, opts: CreateAlertOpts) {
  const { siteId, orgId, rule, severity, title, body, eventId } = opts

  const existing = await db.alert.findFirst({
    where: { site_id: siteId, rule, resolved_at: null },
  })
  if (existing) return existing

  const alert = await db.alert.create({
    data: {
      site_id: siteId,
      org_id: orgId,
      rule,
      severity,
      title,
      body,
      event_id: eventId ?? null,
    },
  })

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { notif_prefs: true } })
  const prefs: NotifPrefs = { ...DEFAULT_PREFS, ...(org?.notif_prefs as Partial<NotifPrefs> ?? {}) }

  if (shouldSendPush(severity, prefs)) {
    await sendPushToOrg(db, orgId, title, body, { alertId: alert.id, siteId, rule })
  }

  if (severity === 'critical' || severity === 'warning') {
    aiQueue.add('ai.brief', { alertId: alert.id }, {
      jobId: `aibrief-${alert.id}`,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5_000 },
    }).catch(err => console.warn('[alerts] ai.brief enqueue failed:', err))
  }

  return alert
}

/**
 * Resolves all open alerts matching site + rule (used for recovery events).
 */
export async function resolveAlert(
  db: PrismaClient,
  siteId: string,
  rule: string,
): Promise<number> {
  const { count } = await db.alert.updateMany({
    where: { site_id: siteId, rule, resolved_at: null },
    data: { resolved_at: new Date() },
  })
  return count
}
