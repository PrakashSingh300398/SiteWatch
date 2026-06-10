import type { PrismaClient } from '@prisma/client'
import { $Enums } from '@prisma/client'
import { sendPushToOrg } from './push'

type AlertSeverity = $Enums.AlertSeverity

interface CreateAlertOpts {
  siteId: string
  orgId: string
  rule: string
  severity: AlertSeverity
  title: string
  body: string
  eventId?: string
}

/**
 * Creates an alert only if no open alert with the same rule+site exists (dedup).
 * Fires push for critical immediately; warning also fires immediately for Phase 1
 * (quiet-hours enforcement comes in Phase 2).
 */
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

  if (severity === 'critical' || severity === 'warning') {
    await sendPushToOrg(db, orgId, title, body, {
      alertId: alert.id,
      siteId,
      rule,
    })
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
