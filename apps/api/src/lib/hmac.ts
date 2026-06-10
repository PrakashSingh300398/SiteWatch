import crypto from 'node:crypto'

const REPLAY_WINDOW_MS = 5 * 60 * 1000 // 5 minutes

export function signRequest(siteKey: string, timestampMs: number, body: string): string {
  return crypto
    .createHmac('sha256', siteKey)
    .update(`${timestampMs}.${body}`)
    .digest('hex')
}

/**
 * Verifies an inbound HMAC-signed agent request.
 * siteKey is stored as plaintext in DB for Phase 1 (Phase 2: AES-256-GCM encrypted at rest).
 */
export function verifyAgentRequest(opts: {
  siteKey: string
  signature: string   // from X-SiteWatch-Signature header (hex or "sha256=<hex>")
  body: string        // raw request body string
  timestamp: string   // from X-SiteWatch-Timestamp header (unix ms as string)
}): boolean {
  const { siteKey, signature, body, timestamp } = opts
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > REPLAY_WINDOW_MS) return false

  const rawSig = signature.replace(/^sha256=/, '')
  const expected = signRequest(siteKey, ts, body)

  try {
    return crypto.timingSafeEqual(Buffer.from(rawSig, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}
