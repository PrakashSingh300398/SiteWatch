import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, Pressable, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from 'react-native'
import { router, Link, useLocalSearchParams } from 'expo-router'
import { api } from '../../src/api/client'
import { colors, spacing, radius } from '../../src/theme'

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string }>()
  const [token, setToken]       = useState(params.token ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (params.token) setToken(params.token)
  }, [params.token])

  const submit = async () => {
    if (!token) { setError('Enter the reset code from your email'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }

    setLoading(true)
    setError(null)
    try {
      await api('/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
        auth: false,
      })
      setDone(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brand}>SiteWatch</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Choose new password</Text>

          {done ? (
            <>
              <Text style={styles.success}>Password updated. You can now sign in.</Text>
              <Pressable style={styles.btn} onPress={() => router.replace('/(auth)/login' as never)}>
                <Text style={styles.btnText}>Sign in</Text>
              </Pressable>
            </>
          ) : (
            <>
              {error && <Text style={styles.error}>{error}</Text>}

              <View style={styles.field}>
                <Text style={styles.label}>Reset code</Text>
                <TextInput
                  style={styles.input}
                  value={token}
                  onChangeText={setToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholderTextColor={colors.dim}
                  placeholder="Paste code from email"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>New password</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  placeholderTextColor={colors.dim}
                  placeholder="At least 8 characters"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Confirm password</Text>
                <TextInput
                  style={styles.input}
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  placeholderTextColor={colors.dim}
                  placeholder="Repeat password"
                  onSubmitEditing={submit}
                />
              </View>

              <Pressable style={[styles.btn, loading && styles.btnDisabled]} onPress={submit} disabled={loading}>
                {loading
                  ? <ActivityIndicator color={colors.text} size="small" />
                  : <Text style={styles.btnText}>Set new password</Text>
                }
              </Pressable>
            </>
          )}

          <View style={styles.footer}>
            <Link href="/(auth)/login" style={styles.link}>Back to sign in</Link>
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
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
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
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
})
