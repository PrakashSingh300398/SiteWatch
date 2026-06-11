import { describe, it, expect } from 'vitest'
import { computeSecurityScore, type ScoreInput } from '../lib/score'

const good: ScoreInput = {
  checklist: {
    disallowFileEdit: true,
    wpDebugOff: true,
    noDefaultAdmin: true,
    xmlrpcDisabled: true,
    userRegistrationClosed: true,
    defaultRole: 'subscriber',
  },
  phpVersion: '8.2.0',
  wpUpdateAvailable: false,
  wpSecurityRelease: false,
  adminCount: 1,
  sslExpiresAt: new Date(Date.now() + 60 * 86_400_000), // 60 days
  activeVulnPlugins: 0,
  inactiveVulnPlugins: 0,
}

describe('computeSecurityScore', () => {
  it('returns 100 when everything is good', () => {
    expect(computeSecurityScore(good).score).toBe(100)
  })

  it('deducts 25 for one active vulnerable plugin', () => {
    const { score } = computeSecurityScore({ ...good, activeVulnPlugins: 1 })
    expect(score).toBe(75)
  })

  it('caps active plugin deduction at 40', () => {
    const { score } = computeSecurityScore({ ...good, activeVulnPlugins: 5 })
    expect(score).toBe(60)
  })

  it('deducts 10 for one inactive vulnerable plugin', () => {
    const { score } = computeSecurityScore({ ...good, inactiveVulnPlugins: 1 })
    expect(score).toBe(90)
  })

  it('deducts 10 for PHP 7.x', () => {
    const { score } = computeSecurityScore({ ...good, phpVersion: '7.4.30' })
    expect(score).toBe(90)
  })

  it('does not deduct for PHP 8.0', () => {
    const { score } = computeSecurityScore({ ...good, phpVersion: '8.0.0' })
    expect(score).toBe(100)
  })

  it('deducts 10 for WP core update available', () => {
    const { score } = computeSecurityScore({ ...good, wpUpdateAvailable: true })
    expect(score).toBe(90)
  })

  it('deducts 20 for WP security release', () => {
    const { score } = computeSecurityScore({ ...good, wpUpdateAvailable: true, wpSecurityRelease: true })
    expect(score).toBe(80)
  })

  it("deducts 10 for 'admin' username", () => {
    const { score } = computeSecurityScore({
      ...good,
      checklist: { ...good.checklist, noDefaultAdmin: false },
    })
    expect(score).toBe(90)
  })

  it('deducts 15 for open registration with author role', () => {
    const { score } = computeSecurityScore({
      ...good,
      checklist: { ...good.checklist, userRegistrationClosed: false, defaultRole: 'author' },
    })
    expect(score).toBe(85)
  })

  it('does not deduct for open registration with subscriber role', () => {
    const { score } = computeSecurityScore({
      ...good,
      checklist: { ...good.checklist, userRegistrationClosed: false, defaultRole: 'subscriber' },
    })
    expect(score).toBe(100)
  })

  it('deducts 5 for file editing enabled', () => {
    const { score } = computeSecurityScore({
      ...good,
      checklist: { ...good.checklist, disallowFileEdit: false },
    })
    expect(score).toBe(95)
  })

  it('deducts 5 for WP_DEBUG on', () => {
    const { score } = computeSecurityScore({
      ...good,
      checklist: { ...good.checklist, wpDebugOff: false },
    })
    expect(score).toBe(95)
  })

  it('deducts 5 for XML-RPC enabled', () => {
    const { score } = computeSecurityScore({
      ...good,
      checklist: { ...good.checklist, xmlrpcDisabled: false },
    })
    expect(score).toBe(95)
  })

  it('deducts 10 for SSL expiring within 14 days', () => {
    const { score } = computeSecurityScore({
      ...good,
      sslExpiresAt: new Date(Date.now() + 7 * 86_400_000),
    })
    expect(score).toBe(90)
  })

  it('does not deduct for SSL expiring in 15 days', () => {
    const { score } = computeSecurityScore({
      ...good,
      sslExpiresAt: new Date(Date.now() + 15 * 86_400_000),
    })
    expect(score).toBe(100)
  })

  it('deducts 5 for more than 5 admin accounts', () => {
    const { score } = computeSecurityScore({ ...good, adminCount: 6 })
    expect(score).toBe(95)
  })

  it('floors at 0 with many issues', () => {
    const { score } = computeSecurityScore({
      checklist: {
        disallowFileEdit: false,
        wpDebugOff: false,
        noDefaultAdmin: false,
        xmlrpcDisabled: false,
        userRegistrationClosed: false,
        defaultRole: 'administrator',
      },
      phpVersion: '5.6.0',
      wpUpdateAvailable: true,
      wpSecurityRelease: true,
      adminCount: 10,
      sslExpiresAt: new Date(Date.now() + 3 * 86_400_000),
      activeVulnPlugins: 5,
      inactiveVulnPlugins: 3,
    })
    expect(score).toBe(0)
  })

  it('returns breakdown keys matching applied deductions', () => {
    // 2 active vulns → min(2×25, 40) = −40; >5 admins → −5; total = 55
    const { score, breakdown } = computeSecurityScore({ ...good, activeVulnPlugins: 2, adminCount: 6 })
    expect(breakdown.active_vuln_plugins).toBe(-40)
    expect(breakdown.admin_count).toBe(-5)
    expect(score).toBe(55)
  })
})
