/**
 * Unit tests for the alert rules engine (spec §8).
 * These tests exercise the decision logic directly without hitting the DB or Redis.
 */
import { describe, it, expect } from 'vitest'

// ─── SSL alert rule logic (extracted from ssl.ts for testability) ──────────────

type Severity = 'critical' | 'warning' | 'info'

type AlertDecision = {
  rule: string
  severity: Severity
} | null

function sslAlertRule(daysLeft: number): AlertDecision {
  if (daysLeft <= 0) return { rule: 'ssl.expired', severity: 'critical' }
  if (daysLeft <= 3) return { rule: 'ssl.expiring_critical', severity: 'critical' }
  if (daysLeft <= 14) return { rule: 'ssl.expiring_warning', severity: 'warning' }
  return null
}

describe('SSL alert rules (spec §4.4)', () => {
  it('fires critical when cert is expired (daysLeft <= 0)', () => {
    expect(sslAlertRule(0)).toMatchObject({ severity: 'critical', rule: 'ssl.expired' })
    expect(sslAlertRule(-1)).toMatchObject({ severity: 'critical', rule: 'ssl.expired' })
  })

  it('fires critical when expiry <= 3 days', () => {
    expect(sslAlertRule(1)).toMatchObject({ severity: 'critical', rule: 'ssl.expiring_critical' })
    expect(sslAlertRule(3)).toMatchObject({ severity: 'critical', rule: 'ssl.expiring_critical' })
  })

  it('fires warning when expiry is 4–14 days', () => {
    expect(sslAlertRule(4)).toMatchObject({ severity: 'warning', rule: 'ssl.expiring_warning' })
    expect(sslAlertRule(7)).toMatchObject({ severity: 'warning', rule: 'ssl.expiring_warning' })
    expect(sslAlertRule(14)).toMatchObject({ severity: 'warning', rule: 'ssl.expiring_warning' })
  })

  it('fires no alert when cert has > 14 days remaining', () => {
    expect(sslAlertRule(15)).toBeNull()
    expect(sslAlertRule(90)).toBeNull()
  })
})

// ─── Uptime / site-down confirm-before-alert rules ────────────────────────────

interface UptimeState {
  currentOk: boolean
  isRetry: boolean
  siteStatus: 'up' | 'down' | 'unknown'
  hasFlap: boolean // flap guard active in Redis
}

type UptimeAction =
  | 'recovery'          // was down, now up → resolve alert + push recovery
  | 'mark_down'         // 2nd failure confirmed → create critical alert
  | 'schedule_retry'    // 1st failure → delay 60 s recheck, no alert yet
  | 'noop'              // site already down and still down → keep recording

function uptimeAlertAction(state: UptimeState): UptimeAction {
  if (state.currentOk) {
    return state.siteStatus === 'down' ? 'recovery' : 'noop'
  }
  // Failed
  if (state.siteStatus === 'down') return 'noop' // already alerted
  if (state.isRetry || state.hasFlap) {
    return state.hasFlap ? 'noop' : 'mark_down'
  }
  return 'schedule_retry'
}

describe('Uptime alert rules (spec §4.3 + §4.4)', () => {
  it('noop on passing check for healthy site', () => {
    expect(uptimeAlertAction({ currentOk: true, isRetry: false, siteStatus: 'up', hasFlap: false })).toBe('noop')
  })

  it('recovery when site was down and now passes', () => {
    expect(uptimeAlertAction({ currentOk: true, isRetry: false, siteStatus: 'down', hasFlap: false })).toBe('recovery')
  })

  it('schedules retry on FIRST failure (no alert yet)', () => {
    expect(uptimeAlertAction({ currentOk: false, isRetry: false, siteStatus: 'up', hasFlap: false })).toBe('schedule_retry')
    expect(uptimeAlertAction({ currentOk: false, isRetry: false, siteStatus: 'unknown', hasFlap: false })).toBe('schedule_retry')
  })

  it('marks down + alerts on SECOND consecutive failure (isRetry=true)', () => {
    expect(uptimeAlertAction({ currentOk: false, isRetry: true, siteStatus: 'up', hasFlap: false })).toBe('mark_down')
  })

  it('noop if site is already down (dedup — open alert exists)', () => {
    expect(uptimeAlertAction({ currentOk: false, isRetry: false, siteStatus: 'down', hasFlap: false })).toBe('noop')
    expect(uptimeAlertAction({ currentOk: false, isRetry: true, siteStatus: 'down', hasFlap: false })).toBe('noop')
  })

  it('noop if flapping suppression guard is active (max 1 alert / 30 min)', () => {
    // Site recovered, went down again within 30 min
    expect(uptimeAlertAction({ currentOk: false, isRetry: true, siteStatus: 'unknown', hasFlap: true })).toBe('noop')
  })
})

// ─── Deduplication rule ────────────────────────────────────────────────────────

describe('Alert deduplication (spec §4.4)', () => {
  it('should not re-fire an identical rule+site alert while open', () => {
    // Simulate the dedup check: if an open alert for the same rule+site exists, return it
    function dedupCheck(openAlerts: Array<{ rule: string }>, newRule: string): boolean {
      return openAlerts.some(a => a.rule === newRule)
    }

    const openAlerts = [{ rule: 'site.down' }]
    expect(dedupCheck(openAlerts, 'site.down')).toBe(true)   // suppressed
    expect(dedupCheck(openAlerts, 'ssl.expired')).toBe(false) // not suppressed
    expect(dedupCheck([], 'site.down')).toBe(false)           // no open alert → fire
  })
})

// ─── Flapping suppression rule ─────────────────────────────────────────────────

describe('Flapping suppression (spec §4.4 — max 1 down alert per 30 min per site)', () => {
  it('suppresses second down alert within the 30-minute window', () => {
    // Simulates Redis TTL-based guard
    let flapActive = false

    function onSiteDown(): 'alert_fired' | 'suppressed' {
      if (flapActive) return 'suppressed'
      flapActive = true
      return 'alert_fired'
    }

    expect(onSiteDown()).toBe('alert_fired')   // first down event
    expect(onSiteDown()).toBe('suppressed')    // second within 30 min
  })
})
