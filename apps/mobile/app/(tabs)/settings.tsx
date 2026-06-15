import React, { useState } from 'react'
import {
  View, Text, StyleSheet, Pressable, Modal,
  TextInput, ActivityIndicator, ScrollView, Alert, Switch,
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

interface TeamMember {
  id: string
  email: string
  role: 'owner' | 'member'
  created_at: string
}

interface Invitation {
  id: string
  email: string
  role: 'owner' | 'member'
  created_at: string
  expires_at: string
}

interface TeamData {
  members: TeamMember[]
  invitations: Invitation[]
}

interface NotifPrefs {
  push_critical: boolean
  push_warning:  boolean
  push_info:     boolean
  quiet_start:   number | null
  quiet_end:     number | null
  quiet_tz:      string
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

  // Invite modal state
  const [showInvite, setShowInvite]     = useState(false)
  const [inviteEmail, setInviteEmail]   = useState('')
  const [inviteRole, setInviteRole]     = useState<'member' | 'owner'>('member')
  const [inviteError, setInviteError]   = useState<string | null>(null)
  const [inviteSent, setInviteSent]     = useState(false)

  const { data: sitesData } = useQuery({
    queryKey: ['sites'],
    queryFn: () => api<{ sites: Site[] }>('/v1/sites'),
  })

  const { data: teamData } = useQuery({
    queryKey: ['team'],
    queryFn: () => api<TeamData>('/v1/team'),
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

  const inviteMutation = useMutation({
    mutationFn: () => api('/v1/team/invite', {
      method: 'POST',
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    }),
    onSuccess: () => {
      setInviteSent(true)
      qc.invalidateQueries({ queryKey: ['team'] })
    },
    onError: (e: Error) => setInviteError(e.message),
  })

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => api(`/v1/team/invitations/${inviteId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => api(`/v1/team/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  })

  const { data: prefsData } = useQuery({
    queryKey: ['notif-prefs'],
    queryFn: () => api<{ prefs: NotifPrefs }>('/v1/notifications/prefs'),
  })

  const prefsMutation = useMutation({
    mutationFn: (patch: Partial<NotifPrefs>) =>
      api<{ prefs: NotifPrefs }>('/v1/notifications/prefs', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notif-prefs'] }),
  })

  const prefs = prefsData?.prefs
  const togglePref = (key: keyof NotifPrefs, val: boolean) => prefsMutation.mutate({ [key]: val })

  const resetModal = () => {
    setShowAdd(false)
    setPairing(null)
    setUrl('')
    setName('')
    setAddError(null)
  }

  const resetInvite = () => {
    setShowInvite(false)
    setInviteEmail('')
    setInviteRole('member')
    setInviteError(null)
    setInviteSent(false)
  }

  const sites   = sitesData?.sites ?? []
  const members = teamData?.members ?? []
  const invitations = teamData?.invitations ?? []
  const isOwner = user?.role === 'owner'

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>

        {/* Account */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="person-circle-outline" size={20} color={colors.muted} />
            <Text style={styles.rowText}>{user?.email}</Text>
            <Text style={styles.roleChip}>{user?.role}</Text>
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

        {/* Team */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Team ({members.length})</Text>
          {isOwner && (
            <Pressable style={styles.addBtn} onPress={() => setShowInvite(true)}>
              <Ionicons name="person-add-outline" size={16} color={colors.text} />
              <Text style={styles.addBtnText}>Invite</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          {members.map((m, i) => (
            <React.Fragment key={m.id}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.row}>
                <Ionicons name="person-outline" size={18} color={colors.muted} />
                <View style={styles.siteInfo}>
                  <Text style={styles.rowText} numberOfLines={1}>{m.email}</Text>
                  <Text style={styles.siteUrl}>{m.role}</Text>
                </View>
                {isOwner && m.id !== user?.id && (
                  <Pressable onPress={() => {
                    Alert.alert('Remove member', `Remove ${m.email}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => removeMemberMutation.mutate(m.id) },
                    ])
                  }}>
                    <Ionicons name="trash-outline" size={18} color={colors.critical} />
                  </Pressable>
                )}
              </View>
            </React.Fragment>
          ))}
        </View>

        {/* Pending invitations */}
        {isOwner && invitations.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Pending Invitations</Text>
            <View style={styles.card}>
              {invitations.map((inv, i) => (
                <React.Fragment key={inv.id}>
                  {i > 0 && <View style={styles.divider} />}
                  <View style={styles.row}>
                    <Ionicons name="mail-outline" size={18} color={colors.muted} />
                    <View style={styles.siteInfo}>
                      <Text style={styles.rowText} numberOfLines={1}>{inv.email}</Text>
                      <Text style={styles.siteUrl}>{inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}</Text>
                    </View>
                    <Pressable onPress={() => cancelInviteMutation.mutate(inv.id)}>
                      <Ionicons name="close-circle-outline" size={20} color={colors.muted} />
                    </Pressable>
                  </View>
                </React.Fragment>
              ))}
            </View>
          </>
        )}

        {/* Notifications */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.card}>
          {([
            ['push_critical', 'Critical alerts', 'Outages, PHP files, vuln plugins'],
            ['push_warning',  'Warning alerts',  'SSL expiry, traffic drops, forms stopped'],
            ['push_info',     'Info alerts',      'Plugin updates, login activity'],
          ] as [keyof NotifPrefs, string, string][]).map(([key, label, sub], i) => (
            <React.Fragment key={key}>
              {i > 0 && <View style={styles.divider} />}
              <View style={styles.row}>
                <View style={styles.siteInfo}>
                  <Text style={styles.rowText}>{label}</Text>
                  <Text style={styles.siteUrl}>{sub}</Text>
                </View>
                <Switch
                  value={prefs ? (prefs[key] as boolean) : true}
                  onValueChange={val => isOwner && togglePref(key, val)}
                  thumbColor={colors.text}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  disabled={!isOwner}
                />
              </View>
            </React.Fragment>
          ))}
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.siteInfo}>
              <Text style={styles.rowText}>Quiet hours</Text>
              <Text style={styles.siteUrl}>
                {prefs?.quiet_start != null && prefs?.quiet_end != null
                  ? `${String(prefs.quiet_start).padStart(2, '0')}:00 – ${String(prefs.quiet_end).padStart(2, '0')}:00 (${prefs.quiet_tz})`
                  : 'Disabled — push any time'}
              </Text>
            </View>
            {isOwner && (
              <Pressable onPress={() => Alert.alert(
                'Quiet hours',
                'Set the hour window (0–23) when non-critical push notifications are silenced.',
                [
                  { text: 'Disable', onPress: () => prefsMutation.mutate({ quiet_start: null, quiet_end: null }) },
                  { text: '22:00 – 07:00', onPress: () => prefsMutation.mutate({ quiet_start: 22, quiet_end: 7 }) },
                  { text: '23:00 – 07:00', onPress: () => prefsMutation.mutate({ quiet_start: 23, quiet_end: 7 }) },
                  { text: 'Cancel', style: 'cancel' },
                ],
              )}>
                <Ionicons name="chevron-forward" size={18} color={colors.dim} />
              </Pressable>
            )}
          </View>
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

      {/* Invite Modal */}
      <Modal visible={showInvite} animationType="slide" presentationStyle="pageSheet" onRequestClose={resetInvite}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Invite team member</Text>
            <Pressable onPress={resetInvite}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>

          {inviteSent ? (
            <View style={styles.pairingSuccess}>
              <Ionicons name="checkmark-circle" size={48} color={colors.up} />
              <Text style={styles.pairingTitle}>Invitation sent!</Text>
              <Text style={styles.pairingInstructions}>
                An email has been sent to {inviteEmail}.{'\n'}
                The link expires in 7 days.
              </Text>
              <Pressable style={styles.btn} onPress={resetInvite}>
                <Text style={styles.btnText}>Done</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.form}>
              {inviteError && <Text style={styles.formError}>{inviteError}</Text>}

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Email address</Text>
                <TextInput
                  style={styles.input}
                  value={inviteEmail}
                  onChangeText={setInviteEmail}
                  placeholder="colleague@example.com"
                  placeholderTextColor={colors.dim}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Role</Text>
                <View style={styles.roleToggle}>
                  {(['member', 'owner'] as const).map(r => (
                    <Pressable
                      key={r}
                      style={[styles.roleOption, inviteRole === r && styles.roleOptionActive]}
                      onPress={() => setInviteRole(r)}
                    >
                      <Text style={[styles.roleOptionText, inviteRole === r && styles.roleOptionTextActive]}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.roleHint}>
                  {inviteRole === 'owner' ? 'Full access — can invite/remove members and manage billing.' : 'Can view all sites and alerts, cannot change team settings.'}
                </Text>
              </View>

              <Pressable
                style={[styles.btn, (inviteMutation.isPending || !inviteEmail) && styles.btnDisabled]}
                onPress={() => inviteMutation.mutate()}
                disabled={inviteMutation.isPending || !inviteEmail}
              >
                {inviteMutation.isPending
                  ? <ActivityIndicator color={colors.text} size="small" />
                  : <Text style={styles.btnText}>Send invitation</Text>
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
  safe:               { flex: 1, backgroundColor: colors.bg },
  container:          { padding: spacing.md, gap: spacing.md },
  sectionTitle:       { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card:               { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  row:                { flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm },
  rowText:            { fontSize: 15, color: colors.text, flex: 1 },
  divider:            { height: 1, backgroundColor: colors.border, marginLeft: spacing.md },
  statusDot:          { width: 10, height: 10, borderRadius: 5 },
  siteInfo:           { flex: 1, minWidth: 0 },
  siteUrl:            { fontSize: 12, color: colors.muted, marginTop: 1 },
  pairedTag:          { fontSize: 12, fontWeight: '500', marginRight: spacing.xs },
  addBtn:             { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  addBtnText:         { fontSize: 13, fontWeight: '600', color: colors.text },
  empty:              { padding: spacing.md, color: colors.muted, fontSize: 14 },
  roleChip:           { fontSize: 11, fontWeight: '600', color: colors.accent, backgroundColor: '#1e1e3f', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  modal:              { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  modalHeader:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  modalTitle:         { fontSize: 20, fontWeight: '700', color: colors.text },
  form:               { gap: spacing.md },
  formError:          { fontSize: 13, color: colors.critical, backgroundColor: '#3f0a0a', padding: spacing.sm, borderRadius: radius.sm },
  field:              { gap: spacing.xs },
  fieldLabel:         { fontSize: 13, fontWeight: '500', color: colors.muted },
  input:              { backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.md, color: colors.text, fontSize: 15 },
  btn:                { backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  btnDisabled:        { opacity: 0.5 },
  btnText:            { color: colors.text, fontWeight: '600', fontSize: 15 },
  pairingSuccess:     { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  pairingTitle:       { fontSize: 22, fontWeight: '700', color: colors.text },
  pairingLabel:       { fontSize: 13, color: colors.muted },
  pairingCode:        { fontSize: 40, fontWeight: '800', color: colors.accent, letterSpacing: 8 },
  pairingInstructions:{ fontSize: 14, color: colors.muted, lineHeight: 22, textAlign: 'center', paddingHorizontal: spacing.md },
  roleToggle:         { flexDirection: 'row', gap: spacing.sm },
  roleOption:         { flex: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surface, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  roleOptionActive:   { backgroundColor: '#1e1e3f', borderColor: colors.accent },
  roleOptionText:     { fontSize: 14, color: colors.muted, fontWeight: '500' },
  roleOptionTextActive:{ color: colors.accent },
  roleHint:           { fontSize: 12, color: colors.muted, lineHeight: 18 },
})
