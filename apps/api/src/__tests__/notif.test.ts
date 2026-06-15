import { describe, it, expect } from 'vitest'

// Replicated from lib/alerts.ts for isolated testing
interface NotifPrefs {
  push_critical: boolean
  push_warning:  boolean
  push_info:     boolean
  quiet_start:   number | null
  quiet_end:     number | null
  quiet_tz:      string
}

function isQuietHours(start: number | null, end: number | null, tz: string, now: Date): boolean {
  if (start === null || end === null) return false
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(now)
    const hour = parseInt(hourStr, 10)
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end
  } catch {
    return false
  }
}

function shouldSendPush(severity: 'critical' | 'warning' | 'info', prefs: NotifPrefs, now = new Date()): boolean {
  if (severity === 'critical') return prefs.push_critical
  const enabled = severity === 'warning' ? prefs.push_warning : prefs.push_info
  if (!enabled) return false
  return !isQuietHours(prefs.quiet_start, prefs.quiet_end, prefs.quiet_tz, now)
}

const DEFAULT: NotifPrefs = {
  push_critical: true, push_warning: true, push_info: false,
  quiet_start: null, quiet_end: null, quiet_tz: 'UTC',
}

// Helper: build a Date at a specific UTC hour
function utcHour(h: number): Date {
  const d = new Date('2026-01-15T00:00:00Z')
  d.setUTCHours(h)
  return d
}

describe('isQuietHours', () => {
  it('returns false when quiet hours not configured', () => {
    expect(isQuietHours(null, null, 'UTC', utcHour(3))).toBe(false)
  })

  it('detects same-day window (22:00–23:00)', () => {
    expect(isQuietHours(22, 23, 'UTC', utcHour(22))).toBe(true)
    expect(isQuietHours(22, 23, 'UTC', utcHour(23))).toBe(false)
    expect(isQuietHours(22, 23, 'UTC', utcHour(21))).toBe(false)
  })

  it('detects overnight window (22:00–07:00)', () => {
    expect(isQuietHours(22, 7, 'UTC', utcHour(22))).toBe(true)
    expect(isQuietHours(22, 7, 'UTC', utcHour(0))).toBe(true)
    expect(isQuietHours(22, 7, 'UTC', utcHour(6))).toBe(true)
    expect(isQuietHours(22, 7, 'UTC', utcHour(7))).toBe(false)
    expect(isQuietHours(22, 7, 'UTC', utcHour(12))).toBe(false)
  })

  it('returns false for invalid timezone', () => {
    expect(isQuietHours(22, 7, 'Not/A/Tz', utcHour(0))).toBe(false)
  })
})

describe('shouldSendPush', () => {
  it('always sends critical regardless of quiet hours', () => {
    const prefs: NotifPrefs = { ...DEFAULT, push_critical: true, quiet_start: 22, quiet_end: 7 }
    expect(shouldSendPush('critical', prefs, utcHour(3))).toBe(true)
  })

  it('suppresses critical when push_critical=false', () => {
    expect(shouldSendPush('critical', { ...DEFAULT, push_critical: false })).toBe(false)
  })

  it('sends warning outside quiet hours', () => {
    const prefs: NotifPrefs = { ...DEFAULT, quiet_start: 22, quiet_end: 7 }
    expect(shouldSendPush('warning', prefs, utcHour(12))).toBe(true)
  })

  it('suppresses warning inside quiet hours', () => {
    const prefs: NotifPrefs = { ...DEFAULT, quiet_start: 22, quiet_end: 7 }
    expect(shouldSendPush('warning', prefs, utcHour(3))).toBe(false)
  })

  it('suppresses warning when push_warning=false regardless of hours', () => {
    const prefs: NotifPrefs = { ...DEFAULT, push_warning: false }
    expect(shouldSendPush('warning', prefs, utcHour(12))).toBe(false)
  })

  it('suppresses info by default', () => {
    expect(shouldSendPush('info', DEFAULT)).toBe(false)
  })

  it('sends info when push_info=true and outside quiet hours', () => {
    const prefs: NotifPrefs = { ...DEFAULT, push_info: true }
    expect(shouldSendPush('info', prefs, utcHour(12))).toBe(true)
  })

  it('suppresses info when push_info=true but inside quiet hours', () => {
    const prefs: NotifPrefs = { ...DEFAULT, push_info: true, quiet_start: 22, quiet_end: 7 }
    expect(shouldSendPush('info', prefs, utcHour(2))).toBe(false)
  })
})
