import React, { useState } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl,
  TextInput, ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../../src/api/client'
import { MetricCard } from '../../src/components/MetricCard'
import { SiteListItem } from '../../src/components/SiteListItem'
import { AlertItem } from '../../src/components/AlertItem'
import { colors, spacing, radius } from '../../src/theme'
import type { DashboardData, Site, Alert } from '../../src/api/types'

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
            : <Text style={styles.empty}>No sites yet. Add one in Settings.</Text>
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
