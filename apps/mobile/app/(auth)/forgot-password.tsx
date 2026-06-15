import React, { useState } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native'
import { router, Link } from 'expo-router'
import { api } from '../../src/api/client'
import { colors, spacing, radius } from '../../src/theme'

export default function ForgotPasswordScreen() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const submit = async () => {
    if (!email) { setError('Enter your email address'); return }
    setLoading(true)
    setError(null)
    try {
      await api('/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
        auth: false,
      })
      setSent(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed')
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
          <Text style={styles.title}>Reset password</Text>

          {sent ? (
            <>
              <Text style={styles.success}>
                Check your email — if that address is registered you'll receive a reset link shortly.
              </Text>
              <Pressable style={styles.btn} onPress={() => router.push('/(auth)/reset-password' as never)}>
                <Text style={styles.btnText}>Enter reset code</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.hint}>Enter your email and we'll send a reset link.</Text>

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
                  onSubmitEditing={submit}
                />
              </View>

              <Pressable style={[styles.btn, loading && styles.btnDisabled]} onPress={submit} disabled={loading}>
                {loading
                  ? <ActivityIndicator color={colors.text} size="small" />
                  : <Text style={styles.btnText}>Send reset link</Text>
                }
              </Pressable>
            </>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerText}>Remember your password? </Text>
            <Link href="/(auth)/login" style={styles.link}>Sign in</Link>
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
  subtitle: { fontSize: 14, color: colors.muted, marginTop: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  hint: { fontSize: 14, color: colors.muted },
  success: { fontSize: 14, color: colors.up, lineHeight: 20 },
  error: { fontSize: 13, color: colors.critical, backgroundColor: '#3f0a0a', padding: spacing.sm, borderRadius: radius.sm },
  field: { gap: 4 },
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
