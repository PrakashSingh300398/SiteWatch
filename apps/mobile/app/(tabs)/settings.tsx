import React, { useState } from 'react'
import {
  View, Text, StyleSheet, Pressable, Modal,
  TextInput, ActivityIndicator, ScrollView, Alert,
} from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../src/api/client'
import { useAuthContext } from '../../src/context/AuthContext'
import { colors, spacing, radius } from '../../src/theme'
import type { Site } from '../../src/api/types'

interface AddSiteResult {
  site: Site
  pairingCode: string
}

export default function SettingsScreen() {
  const { user, signOut } = useAuthContext()
  const qc = useQueryClient()

  // Add-site modal state
  const [showAdd, setShowAdd]     = useState(false)
  const [url, setUrl]             = useState('')
  const [name, setName]           = useState('')
  const [pairingCode, setPairing] = useState<string | null>(null)
  const [addError, setAddError]   = useState<string | null>(null)

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api<{ sites: Site[] }>('/v1/sites'),
  })

  const addMutation = useMutation({
    mutationFn: () => api<AddSiteResult>('/v1/sites', {
      method: 'POST',
      body: JSON.stringify({ url, name, checkIntervalSec: 300 }),
    }),
    onSuccess: data => {
      setPairing(data.pairingCode)
      qc.invalidateQueries({ queryKey: ['sites'] })
    },
    onError: (e: Error) => setAddError(e.message),
  })

  const resetModal = () => {
    setShowAdd(false)
    setPairing(null)
    setUrl('')
    setName('')
    setAddError(null)
  }

  const sites = sitesData?.sites ?? []

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>

        {/* Account */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={20} color={colors.muted} />
            <Text style={styles.rowText}>{user?.email}</Text>
          </View>
          <View style={styles.divider} />
          <Pressable style={styles.row} onPress={() => {
            Alert.alert('Sign out', 'Are you sure?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: async () => { await signOut(); router.replace('/(auth)/login') } },
            ])
          }}>
            <Ionicons name="log-out-outline" size={20} color={colors.critical} />
            <Text style={[styles.rowText, { color: colors.critical }]}>Sign out</Text>
          </Pressable>
        </View>

        {/* Sites */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Sites ({sites.length})</Text>
          <Pressable style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <Ionicons name="add" size={18} color={colors.text} />
            <Text style={styles.addBtnText}>Add site</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          {sites.length === 0 && (
            <Text style={styles.empty}>No sites yet. Tap "Add site" to get started.</Text>
          )}
          {sites.map((site, i) => (
            <React.Fragment key={site.id}>
              {i > 0 && <View style={styles.divider} />}
              <Pressable style={styles.row} onPress={() => router.push(`/sites/${site.id}` as never)}>
                <View style={[styles.statusDot, { backgroundColor: site.status === 'up' ? colors.up : site.status === 'down' ? colors.down : colors.unknown }]} />
                <View style={styles.siteInfo}>
                  <Text style={styles.rowText} numberOfLines={1}>{site.name}</Text>
                  <Text style={styles.siteUrl} numberOfLines={1}>{site.url}</Text>
                </View>
                <Text style={[styles.pairedTag, { color: site.paired_at ? colors.up : colors.muted }]}>
                  {site.paired_at ? 'Paired' : 'Not paired'}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={colors.dim} />
              </Pressable>
            </React.Fragment>
          ))}
        </View>

      </ScrollView>

      {/* Add Site Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={resetModal}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add site</Text>
            <Pressable onPress={resetModal}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          {pairingCode ? (
            <View style={styles.pairingSuccess}>
              <Ionicons name="checkmark-circle" size={48} color={colors.up} />
              <Text style={styles.pairingTitle}>Site added!</Text>
              <Text style={styles.pairingLabel}>Pairing code</Text>
              <Text style={styles.pairingCode}>{pairingCode}</Text>
              <Text style={styles.pairingInstructions}>
                1. Install the SiteWatch Agent plugin on your WordPress site.{'\n'}
                2. Go to Settings → SiteWatch Agent.{'\n'}
                3. Enter this 6-character code.{'\n'}
                4. The code expires in 15 minutes.
              </Text>
              <Pressable style={styles.btn} onPress={resetModal}>
                <Text style={styles.btnText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              {addError && <Text style={styles.formError}>{addError}</Text>}

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Site name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="My Client Site"
                  placeholderTextColor={colors.dim}
                  autoCapitalize="words"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Site URL</Text>
                <TextInput
                  style={styles.input}
                  value={url}
                  onChangeText={setUrl}
                  placeholder="https://example.com"
                  placeholderTextColor={colors.dim}
                  keyboardType="url"
                  autoCapitalize="none"
                />
              </View>

              <Pressable
                style={[styles.btn, (addMutation.isPending || !url || !name) && styles.btnDisabled]}
                onPress={() => addMutation.mutate()}
                disabled={addMutation.isPending || !url || !name}
              >
                {addMutation.isPending
                  ? <ActivityIndicator color={colors.text} size="small" />
                  : <Text style={styles.btnText}>Generate pairing code</Text>
                }
              </Pressable>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe:         { flex: 1, backgroundColor: colors.bg },
  container:    { padding: spacing.md, gap: spacing.md },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card:         { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  row:          { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  rowText:      { fontSize: 15, color: colors.text, flex: 1 },
  divider:      { height: 1, backgroundColor: colors.border, marginLeft: spacing.md },
  statusDot:    { width: 10, height: 10, borderRadius: 5 },
  siteInfo:     { flex: 1, minWidth: 0 },
  siteUrl:      { fontSize: 12, color: colors.muted, marginTop: 1 },
  pairedTag:    { fontSize: 12, fontWeight: '500', marginRight: spacing.xs },
  addBtn:       { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  addBtnText:   { fontSize: 13, fontWeight: '600', color: colors.text },
  empty:        { padding: spacing.md, color: colors.muted, fontSize: 14 },
  modal:        { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle:   { fontSize: 20, fontWeight: '700', color: colors.text },
  form:         { gap: spacing.md },
  formError:    { fontSize: 13, color: colors.critical, backgroundColor: '#3f0a0a', padding: spacing.sm, borderRadius: radius.sm },
  field:        { gap: spacing.xs },
  fieldLabel:   { fontSize: 13, fontWeight: '500', color: colors.muted },
  input:        { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, color: colors.text, fontSize: 15 },
  btn:          { backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  btnDisabled:  { opacity: 0.5 },
  btnText:      { color: colors.text, fontWeight: '600', fontSize: 15 },
  pairingSuccess:{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  pairingTitle: { fontSize: 22, fontWeight: '700', color: colors.text },
  pairingLabel: { fontSize: 13, color: colors.muted },
  pairingCode:  { fontSize: 40, fontWeight: '800', color: colors.accent, letterSpacing: 8 },
  pairingInstructions: { fontSize: 14, color: colors.muted, lineHeight: 22, textAlign: 'center', paddingHorizontal: spacing.md },
})
