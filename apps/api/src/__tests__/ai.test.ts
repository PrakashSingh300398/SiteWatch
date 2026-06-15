import { describe, it, expect } from 'vitest'
import { stripPii } from '../lib/anthropic'

describe('stripPii', () => {
  it('redacts email addresses in strings', () => {
    expect(stripPii('user@example.com')).toBe('[email]')
    expect(stripPii('contact admin@site.co.uk for help')).toBe('contact [email] for help')
  })

  it('redacts email fields in objects', () => {
    const result = stripPii({ user_login: 'admin', email: 'admin@site.com', action: 'login' }) as Record<string, unknown>
    expect(result.email).toBe('[email]')
    expect(result.user_login).toBe('admin')
    expect(result.action).toBe('login')
  })

  it('drops sensitive key fields', () => {
    const result = stripPii({ password: 'secret', token: 'abc123', name: 'test' }) as Record<string, unknown>
    expect(result.password).toBeUndefined()
    expect(result.token).toBeUndefined()
    expect(result.name).toBe('test')
  })

  it('drops site_key_hash', () => {
    const result = stripPii({ site_key_hash: 'abc', url: 'https://example.com' }) as Record<string, unknown>
    expect(result.site_key_hash).toBeUndefined()
    expect(result.url).toBe('https://example.com')
  })

  it('truncates IP to first two octets', () => {
    const result = stripPii({ ip: '192.168.1.55', action: 'login' }) as Record<string, unknown>
    expect(result.ip).toBe('192.168.x.x')
  })

  it('handles IPv6-style or unparseable IP gracefully', () => {
    const result = stripPii({ ip: '2001:db8::1' }) as Record<string, unknown>
    expect(result.ip).toBe('[ip]')
  })

  it('recurses into nested objects', () => {
    const result = stripPii({ actor: { email: 'u@e.com', user_login: 'u', password: 'pw' } }) as Record<string, unknown>
    const actor = result.actor as Record<string, unknown>
    expect(actor.email).toBe('[email]')
    expect(actor.password).toBeUndefined()
    expect(actor.user_login).toBe('u')
  })

  it('recurses into arrays', () => {
    const result = stripPii([{ email: 'a@b.com' }, { name: 'ok' }]) as Array<Record<string, unknown>>
    expect(result[0].email).toBe('[email]')
    expect(result[1].name).toBe('ok')
  })

  it('handles null and undefined safely', () => {
    expect(stripPii(null)).toBeNull()
    expect(stripPii(undefined)).toBeUndefined()
  })

  it('passes through numbers and booleans unchanged', () => {
    expect(stripPii(42)).toBe(42)
    expect(stripPii(true)).toBe(true)
  })
})

// Monthly quota logic
const PLAN_QUOTA: Record<string, number> = { starter: 100, pro: 500, agency: 500 }

function isQuotaExceeded(plan: string, usage: number): boolean {
  return usage >= (PLAN_QUOTA[plan] ?? 100)
}

describe('AI brief quota', () => {
  it('blocks at limit', () => {
    expect(isQuotaExceeded('starter', 100)).toBe(true)
    expect(isQuotaExceeded('pro', 500)).toBe(true)
  })

  it('allows below limit', () => {
    expect(isQuotaExceeded('starter', 99)).toBe(false)
    expect(isQuotaExceeded('pro', 499)).toBe(false)
  })

  it('pro and agency get higher quota', () => {
    expect(PLAN_QUOTA['pro']).toBeGreaterThan(PLAN_QUOTA['starter'])
    expect(PLAN_QUOTA['agency']).toBe(PLAN_QUOTA['pro'])
  })

  it('defaults to starter quota for unknown plan', () => {
    expect(isQuotaExceeded('enterprise', 100)).toBe(true)
    expect(isQuotaExceeded('enterprise', 99)).toBe(false)
  })
})
