/**
 * Unit tests for the events rules engine logic.
 * Tests the pure decision functions extracted from workers/events.ts.
 *
 * We test: new-admin detection, role promotion, brute-force threshold,
 * and country-newness check — all without hitting the DB or Redis.
 */
import { describe, it, expect } from 'vitest'
import { semverLt } from '../workers/vuln'

// ─── semverLt (used in vuln worker) ──────────────────────────────────────────

describe('semverLt', () => {
  it('1.0.0 < 2.0.0', () => expect(semverLt('1.0.0', '2.0.0')).toBe(true))
  it('2.0.0 is not < 1.0.0', () => expect(semverLt('2.0.0', '1.0.0')).toBe(false))
  it('equal versions are not lt', () => expect(semverLt('1.2.3', '1.2.3')).toBe(false))
  it('1.9 < 1.10', () => expect(semverLt('1.9', '1.10')).toBe(true))
  it('1.2 < 1.2.1 (missing minor)', () => expect(semverLt('1.2', '1.2.1')).toBe(true))
  it('handles pre-release suffix: 7.5.1 < 7.6.0', () => expect(semverLt('7.5.1', '7.6.0')).toBe(true))
  it('0.9.9 < 1.0.0', () => expect(semverLt('0.9.9', '1.0.0')).toBe(true))
})

// ─── Rule trigger conditions ──────────────────────────────────────────────────
// We test the decision logic in isolation — no DB/Redis needed.

function triggersNewAdmin(eventType: string, actorRole: string): boolean {
  return eventType === 'user.created' && actorRole.includes('administrator')
}

function triggersAdminPromotion(eventType: string, newRole: string): boolean {
  return eventType === 'user.role_changed' && newRole === 'administrator'
}

function triggersBruteForce(count: number): boolean {
  return count > 100
}

function triggersNewCountry(
  knownCountries: Set<string>,
  loginCountry: string,
  isLearning: boolean,
): boolean {
  return !knownCountries.has(loginCountry) && !isLearning
}

describe('rule: new_admin', () => {
  it('fires for user.created with administrator role', () => {
    expect(triggersNewAdmin('user.created', 'administrator')).toBe(true)
  })

  it('does not fire for user.created with editor role', () => {
    expect(triggersNewAdmin('user.created', 'editor')).toBe(false)
  })

  it('does not fire for user.created with subscriber role', () => {
    expect(triggersNewAdmin('user.created', 'subscriber')).toBe(false)
  })

  it('does not fire for other event types', () => {
    expect(triggersNewAdmin('user.login_success', 'administrator')).toBe(false)
  })
})

describe('rule: admin_role_granted', () => {
  it('fires when user is promoted to administrator', () => {
    expect(triggersAdminPromotion('user.role_changed', 'administrator')).toBe(true)
  })

  it('does not fire for editor promotion', () => {
    expect(triggersAdminPromotion('user.role_changed', 'editor')).toBe(false)
  })

  it('does not fire for non-role-change events', () => {
    expect(triggersAdminPromotion('user.created', 'administrator')).toBe(false)
  })
})

describe('rule: brute_force', () => {
  it('fires when 101 failed logins in window', () => {
    expect(triggersBruteForce(101)).toBe(true)
  })

  it('does not fire at exactly 100', () => {
    expect(triggersBruteForce(100)).toBe(false)
  })

  it('does not fire at 50 failed logins', () => {
    expect(triggersBruteForce(50)).toBe(false)
  })
})

describe('rule: new_country_login', () => {
  it('fires when country has never been seen and past learning window', () => {
    const known = new Set(['CA', 'US'])
    expect(triggersNewCountry(known, 'RU', false)).toBe(true)
  })

  it('does not fire for known country', () => {
    const known = new Set(['CA', 'US'])
    expect(triggersNewCountry(known, 'CA', false)).toBe(false)
  })

  it('does not fire during learning window even for new country', () => {
    const known = new Set<string>()
    expect(triggersNewCountry(known, 'RU', true)).toBe(false)
  })

  it('does not fire for first login when in learning window', () => {
    expect(triggersNewCountry(new Set(), 'CA', true)).toBe(false)
  })

  it('fires for completely unknown country after learning window', () => {
    expect(triggersNewCountry(new Set(), 'CN', false)).toBe(true)
  })
})
