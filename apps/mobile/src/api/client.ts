import Constants from 'expo-constants'
import { getAccessToken, getRefreshToken, storeSession, clearSession } from '../store/auth'
import type { AuthUser } from './types'

export const API_URL: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000'

// Refreshes the access token using the stored refresh token.
// Returns the new access token or null on failure (session expired).
async function doRefresh(): Promise<string | null> {
  const refreshToken = await getRefreshToken()
  if (!refreshToken) return null
  try {
    const resp = await fetch(`${API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!resp.ok) { await clearSession(); return null }
    const data = await resp.json() as { accessToken: string; refreshToken: string; user: AuthUser }
    await storeSession(data.accessToken, data.refreshToken, data.user)
    return data.accessToken
  } catch {
    return null
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<T>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, ...fetchOpts } = opts
  let token = auth ? await getAccessToken() : null

  const make = (t: string | null) =>
    fetch(`${API_URL}${path}`, {
      ...fetchOpts,
      headers: {
        'Content-Type': 'application/json',
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
        ...(fetchOpts.headers ?? {}),
      },
    })

  let resp = await make(token)

  // Single retry after token refresh on 401
  if (resp.status === 401 && auth && token) {
    token = await doRefresh()
    if (!token) throw new ApiError(401, 'Session expired')
    resp = await make(token)
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText })) as { error?: string }
    throw new ApiError(resp.status, err.error ?? `HTTP ${resp.status}`)
  }

  return resp.json() as Promise<T>
}
