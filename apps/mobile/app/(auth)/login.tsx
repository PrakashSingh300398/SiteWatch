import React, { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native'
import { router, Link } from 'expo-router'
import { api } from '../../src/api/client'
import { storeSession } from '../../src/store/auth'
import { useAuthContext } from '../../src/context/AuthContext'
import { colors, spacing, radius } from '../../src/theme'
import type { AuthUser } from '../../src/api/types'

export default function LoginScreen() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const { reload } = useAuthContext()

  const submit = async () => {
    if (!email || !password) { setError('Email and password are required'); return }
    setLoading(true)
    setError(null)
    try {
      const data = await api<{ accessToken: string; refreshToken: string; user: AuthUser }>(
        '/v1/auth/login',
        { method: 'POST', body: JSON.stringify({ email, password }), auth: false },
      )
      await storeSession(data.accessToken, data.refreshToken, data.user)
      await reload()
      router.replace('/(tabs)/')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brand}>SiteWatch</Text>
          <Text style={styles.subtitle}>WordPress monitoring for your sites</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Sign in</Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              placeholderTextColor={colors.dim}
              placeholder="you@example.com"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="current-password"
              placeholderTextColor={colors.dim}
              placeholder="••••••••"
              onSubmitEditing={submit}
            />
          </View>

          <Pressable style={[styles.btn, loading && styles.btnDisabled]} onPress={submit} disabled={loading}>
            {loading
              ? <ActivityIndicator color={colors.text} size="small" />
              : <Text style={styles.btnText}>Sign in</Text>
            }
          </Pressable>

          <View style={styles.footer}>
            <Link href="/(auth)/forgot-password" style={styles.link}>Forgot password?</Link>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Link href="/(auth)/register" style={styles.link}>Register</Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  brand: { fontSize: 32, fontWeight: '800', color: colors.text, letterSpacing: -1 },
  subtitle: { fontSize: 14, color: colors.muted, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  error: { fontSize: 13, color: colors.critical, backgroundColor: '#3f0a0a', padding: spacing.sm, borderRadius: radius.sm },
  field: { gap: spacing.xs },
  label: { fontSize: 13, fontWeight: '500', color: colors.muted },
  input: {
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.text, fontWeight: '600', fontSize: 15 },
  footer: { flexDirection: 'row', justifyContent: 'center' },
  footerText: { color: colors.muted, fontSize: 13 },
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
})
