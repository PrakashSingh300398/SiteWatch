import * as SecureStore from 'expo-secure-store'
import type { AuthUser } from '../api/types'

const KEYS = {
  accessToken: 'sw_access_token',
  refreshToken: 'sw_refresh_token',
  user: 'sw_user',
}

export async function storeSession(accessToken: string, refreshToken: string, user: AuthUser) {
  await Promise.all([
    SecureStore.setItemAsync(KEYS.accessToken, accessToken),
    SecureStore.setItemAsync(KEYS.refreshToken, refreshToken),
    SecureStore.setItemAsync(KEYS.user, JSON.stringify(user)),
  ])
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.accessToken)
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.refreshToken)
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync(KEYS.user)
  if (!raw) return null
  try { return JSON.parse(raw) as AuthUser } catch { return null }
}

export async function clearSession() {
  await Promise.all(Object.values(KEYS).map(k => SecureStore.deleteItemAsync(k)))
}
