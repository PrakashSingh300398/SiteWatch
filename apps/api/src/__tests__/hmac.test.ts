import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signRequest, verifyAgentRequest } from '../lib/hmac'

describe('HMAC verification', () => {
  const SITE_KEY = 'super-secret-site-key-64-chars-aaaabbbbccccddddeeeeffffgggghhhh'
  const NOW = 1_700_000_000_000

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  it('accepts a valid signature', () => {
    const body = JSON.stringify({ foo: 'bar' })
    const sig = signRequest(SITE_KEY, NOW, body)
    expect(
      verifyAgentRequest({ siteKey: SITE_KEY, signature: sig, body, timestamp: String(NOW) }),
    ).toBe(true)
  })

  it('accepts sha256= prefix on signature', () => {
    const body = '{}'
    const sig = `sha256=${signRequest(SITE_KEY, NOW, body)}`
    expect(
      verifyAgentRequest({ siteKey: SITE_KEY, signature: sig, body, timestamp: String(NOW) }),
    ).toBe(true)
  })

  it('rejects a wrong key', () => {
    const body = '{}'
    const sig = signRequest('wrong-key', NOW, body)
    expect(
      verifyAgentRequest({ siteKey: SITE_KEY, signature: sig, body, timestamp: String(NOW) }),
    ).toBe(false)
  })

  it('rejects a tampered body', () => {
    const body = '{"foo":"bar"}'
    const sig = signRequest(SITE_KEY, NOW, body)
    expect(
      verifyAgentRequest({ siteKey: SITE_KEY, signature: sig, body: '{"foo":"baz"}', timestamp: String(NOW) }),
    ).toBe(false)
  })

  it('rejects a request outside the 5-minute replay window (too old)', () => {
    const oldTs = NOW - 6 * 60 * 1000
    const body = '{}'
    const sig = signRequest(SITE_KEY, oldTs, body)
    expect(
      verifyAgentRequest({ siteKey: SITE_KEY, signature: sig, body, timestamp: String(oldTs) }),
    ).toBe(false)
  })

  it('rejects a request outside the replay window (future clock skew)', () => {
    const futureTs = NOW + 6 * 60 * 1000
    const body = '{}'
    const sig = signRequest(SITE_KEY, futureTs, body)
    expect(
      verifyAgentRequest({ siteKey: SITE_KEY, signature: sig, body, timestamp: String(futureTs) }),
    ).toBe(false)
  })

  it('rejects a non-numeric timestamp', () => {
    const body = '{}'
    const sig = signRequest(SITE_KEY, NOW, body)
    expect(
      verifyAgentRequest({ siteKey: SITE_KEY, signature: sig, body, timestamp: 'not-a-number' }),
    ).toBe(false)
  })
})
