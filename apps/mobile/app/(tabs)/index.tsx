import React, { useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator, Pressable,
} from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../src/api/client'
import { MetricCard } from '../../src/components/MetricCard'
import { SiteListItem } from '../../src/components/SiteListItem'
import { AlertItem } from '../../src/components/AlertItem'
import { colors, spacing, radius } from '../../src/theme'
import type { DashboardData, Site, Alert } from '../../src/api/types'

const ONBOARDING_STEPS = [
  { icon: 'download-outline' as const,      title: 'Install the plugin',   desc: 'Download the SiteWatch Agent plugin and install it on your WordPress site.' },
  { icon: 'settings-outline' as const,      title: 'Add a site',           desc: 'Go to Settings → tap "Add site" → enter the site name and URL.' },
  { icon: 'link-outline' as const,          title: 'Pair with the code',   desc: 'Copy the 6-character pairing code → paste it in Settings → SiteWatch Agent on your WP site.' },
]

function OnboardingCard() {
  return (
    <View style={obStyles.card}>
      <Text style={obStyles.title}>Welcome to SiteWatch</Text>
      <Text style={obStyles.sub}>Connect your first WordPress site in 3 steps.</Text>
      {ONBOARDING_STEPS.map((step, i) => (
        <View key={i} style={obStyles.step}>
          <View style={obStyles.stepIcon}>
            <Ionicons name={step.icon} size={22} color={colors.accent} />
          </View>
          <View style={obStyles.stepText}>
            <Text style={obStyles.stepTitle}>{step.title}</Text>
            <Text style={obStyles.stepDesc}>{step.desc}</Text>
          </View>
        </View>
      ))}
      <Pressable style={obStyles.btn} onPress={() => router.push('/(tabs)/settings' as never)}>
        <Ionicons name="add" size={18} color={colors.text} />
        <Text style={obStyles.btnText}>Add your first site</Text>
      </Pressable>
    </View>
  )
}

const obStyles = StyleSheet.create({
  card: { margin: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  sub: { fontSize: 14, color: colors.muted },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  stepDesc: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.xs },
  btnText: { color: colors.text, fontWeight: '600', fontSize: 15 },
})

export default function DashboardScreen() {
  const [search, setSearch] = useState('')

  const { data: dash, isLoading: dashLoading, refetch: refetchDash } =
    useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/v1/dashboard') })

  const { data: sitesData, isLoading: sitesLoading, refetch: refetchSites } =
    useQuery({ queryKey: ['sites'], queryFn: () => api<{ sites: Site[] }>('/v1/sites') })

  const { data: alertsData, refetch: refetchAlerts } =
    useQuery({
      queryKey: ['alerts', 'open'],
      queryFn: () => api<{ alerts: Alert[] }>('/v1/alerts?status=open'),
    })

  const isLoading = dashLoading || sitesLoading
  const refresh = async () => { await Promise.all([refetchDash(), refetchSites(), refetchAlerts()]) }

  const sites = (sitesData?.sites ?? []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase())
  )

  const urgentAlerts = (alertsData?.alerts ?? [])
    .filter(a => a.severity !== 'info' && !a.acknowledged_at)
    .slice(0, 3)

  const openAlerts = dash?.alerts.open ?? {}
  const criticalCount = openAlerts['critical'] ?? 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <FlatList
        data={sites}
        keyExtractor={item => item.id}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View>
            {/* Metric cards */}
            <View style={styles.metrics}>
              <MetricCard
                label="Sites Up"
                value={`${dash?.sites.up ?? '—'}/${dash?.sites.total ?? '—'}`}
                accent={dash?.sites.down ? colors.down : colors.up}
              />
              <MetricCard
                label="Alerts"
                value={criticalCount}
                accent={criticalCount > 0 ? colors.critical : colors.muted}
                sub="critical open"
              />
              <MetricCard
                label="SSL"
                value={dash?.ssl.expiringSoon ?? '—'}
                accent={dash && dash.ssl.expiringSoon > 0 ? colors.warning : colors.muted}
                sub="expiring soon"
              />
              <MetricCard
                label="Updates"
                value={dash?.updates.pending ?? '—'}
                accent={dash && dash.updates.pending > 0 ? colors.warning : colors.muted}
              />
            </View>

            {/* Needs attention */}
            {urgentAlerts.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Needs attention</Text>
                {urgentAlerts.map(alert => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    onPress={() => router.push(`/sites/${alert.site_id}` as never)}
                  />
                ))}
              </View>
            )}

            {/* Sites header + search */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Sites ({sites.length})</Text>
              <TextInput
                style={styles.search}
                value={search}
                onChangeText={setSearch}
                placeholder="Search sites…"
                placeholderTextColor={colors.dim}
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <SiteListItem
            site={item}
            onPress={() => router.push(`/sites/${item.id}` as never)}
          />
        )}
        ListEmptyComponent={
          isLoading
            ? <ActivityIndicator style={{ marginTop: spacing.xl }} color={colors.accent} />
            : <OnboardingCard />
        }
        style={styles.list}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  list: { flex: 1 },
  metrics: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  section: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.sm },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.text,
    fontSize: 14,
  },
  empty: { textAlign: 'center', color: colors.muted, marginTop: spacing.xl, padding: spacing.md },
})
