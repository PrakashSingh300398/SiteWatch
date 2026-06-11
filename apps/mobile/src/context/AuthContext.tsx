import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { getAccessToken, getStoredUser, clearSession } from '../store/auth'
import type { AuthUser } from '../api/types'

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  signOut: () => Promise<void>
  reload: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  signOut: async () => {},
  reload: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const reload = useCallback(async () => {
    const [token, stored] = await Promise.all([getAccessToken(), getStoredUser()])
    setUser(token && stored ? stored : null)
    setIsLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  const signOut = useCallback(async () => {
    await clearSession()
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, signOut, reload }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuthContext = () => useContext(AuthContext)
