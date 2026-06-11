import React, { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { AuthProvider, useAuthContext } from '../src/context/AuthContext'
import { api } from '../src/api/client'
import { colors } from '../src/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

function RootNav() {
  const { user, isLoading } = useAuthContext()

  // Register push token once authenticated
  useEffect(() => {
    if (!user) return
    ;(async () => {
      const { status: existing } = await Notifications.getPermissionsAsync()
      const { status } = existing === 'granted'
        ? { status: existing }
        : await Notifications.requestPermissionsAsync()
      if (status !== 'granted') return

      const tokenData = await Notifications.getExpoPushTokenAsync().catch(() => null)
      if (!tokenData) return
      await api('/v1/devices', {
        method: 'POST',
        body: JSON.stringify({ token: tokenData.data }),
      }).catch(() => {})
    })()
  }, [user])

  // Deep-link navigation from push notifications
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as { url?: string }
      if (data.url) router.push(data.url as never)
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    if (isLoading) return
    if (user) {
      router.replace('/(tabs)/')
    } else {
      router.replace('/(auth)/login')
    }
  }, [user, isLoading])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)"  options={{ animation: 'none' }} />
      <Stack.Screen name="(tabs)"  options={{ animation: 'none' }} />
      <Stack.Screen name="sites/[id]" options={{ headerShown: true, headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerBackTitle: 'Back' }} />
    </Stack>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <RootNav />
          </AuthProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  )
}
