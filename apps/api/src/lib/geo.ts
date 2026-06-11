import { redis } from './redis'

export interface GeoResult {
  country: string
  countryCode: string
  city: string
}

const GEO_TTL_SEC = 24 * 3600

// RFC-1918 + loopback — skip API calls for private IPs
const PRIVATE_IP = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|localhost$)/

export async function geoLookup(ip: string): Promise<GeoResult | null> {
  if (!ip || PRIVATE_IP.test(ip)) return null

  const key = `geo:${ip}`
  const cached = await redis.get(key)
  if (cached) {
    try { return JSON.parse(cached) as GeoResult } catch { /* fall through */ }
  }

  try {
    const res = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city`,
      { signal: AbortSignal.timeout(5_000) },
    )
    if (!res.ok) return null
    const body = await res.json() as { status: string; country: string; countryCode: string; city: string }
    if (body.status !== 'success') return null

    const result: GeoResult = { country: body.country, countryCode: body.countryCode, city: body.city }
    await redis.set(key, JSON.stringify(result), 'EX', GEO_TTL_SEC)
    return result
  } catch {
    return null
  }
}
