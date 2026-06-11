import React, { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator, FlatList,
} from 'react-native'
import { useLocalSearchParams, Stack } from 'expo-router'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../src/api/client'
import { UptimeChart, ResponseSparkline } from '../../src/components/UptimeChart'
import { ScoreGauge } from '../../src/components/ScoreGauge'
import { StatusDot } from '../../src/components/StatusDot'
import { colors, spacing, radius, severityColor } from '../../src/theme'
import type { SiteDetail, UptimeCheck, SiteEvent, Plugin } from '../../src/api/types'

type Tab = 'overview' | 'security'

export default function SiteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('overview')
  const [uptimeRange, setUptimeRange] = useState<'24h' | '7d' | '30d'>('24h')

  const { data: siteData, isLoading: siteLoading, refetch: refetchSite } =
    useQuery({
      queryKey: ['site', id],
      queryFn: () => api<{ site: SiteDetail }>(`/v1/sites/${id}`),
    })

  const { data: uptimeData, isLoading: uptimeLoading, refetch: refetchUptime } =
    useQuery({
      queryKey: ['uptime', id, uptimeRange],
      queryFn: () => api<{ checks: UptimeCheck[]; uptimePct: number | null }>(`/v1/sites/${id}/uptime?range=${uptimeRange}`),
    })

  const {
    data: eventsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchEvents,
  } = useInfiniteQuery({
    queryKey: ['events', id],
    queryFn: ({ pageParam }) =>
      api<{ events: SiteEvent[]; nextCursor: string | null }>(
        `/v1/sites/${id}/events?limit=30${pageParam ? `&before=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last => last.nextCursor ?? undefined,
    enabled: tab === 'security',
  })

  const site    = siteData?.site
  const checks  = uptimeData?.checks ?? []
  const events  = eventsData?.pages.flatMap(p => p.events) ?? []
  const plugins: Plugin[] = siteData?.site.plugins ?? []
  const vulnPlugins    = plugins.filter(p => p.vulnerable)
  const updatePlugins  = plugins.filter(p => p.update_available)

  const isRefreshing = siteLoading || uptimeLoading
  const onRefresh = async () => {
    await Promise.all([refetchSite(), refetchUptime(), tab === 'security' && refetchEvents()])
  }

  if (!site && !siteLoading) {
    return <View style={styles.center}><Text style={styles.muted}>Site not found</Text></View>
  }

  const sslDaysLeft = site?.ssl_status?.expires_at
    ? Math.ceil((new Date(site.ssl_status.expires_at).getTime() - Date.now()) / 86_400_000)
    : null

  return (
    <>
      <Stack.Screen options={{ title: site?.name ?? '…' }} />
      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {/* Site header */}
        {site && (
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <StatusDot status={site.status} size={14} />
              <Text style={styles.status}>{site.status.toUpperCase()}</Text>
            </View>
            <View style={styles.headerRight}>
              {uptimeData?.checks?.[0]?.response_ms != null && <Text style={styles.respTime}>{uptimeData.checks[0].response_ms}ms</Text>}
              {uptimeData?.uptimePct != null && (
                <Text style={[styles.uptimePct, { color: uptimeData.uptimePct < 99 ? colors.warning : colors.up }]}>
                  {uptimeData.uptimePct.toFixed(2)}% uptime
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Tab bar */}
        <View style={styles.tabBar}>
          {(['overview', 'security'] as Tab[]).map(t => (
            <Pressable key={t} style={[styles.tabBtn, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'overview' ? (
          <View style={styles.content}>
            {/* Uptime chart */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Uptime</Text>
                <View style={styles.rangeRow}>
                  {(['24h', '7d', '30d'] as const).map(r => (
                    <Pressable key={r} style={[styles.rangeBtn, uptimeRange === r && styles.rangeBtnActive]} onPress={() => setUptimeRange(r)}>
                      <Text style={[styles.rangeBtnText, uptimeRange === r && styles.rangeBtnTextActive]}>{r}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {uptimeLoading
                ? <ActivityIndicator color={colors.accent} />
                : <UptimeChart checks={checks} />
              }
            </View>

            {/* Response time sparkline */}
            {checks.length > 1 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Response time</Text>
                <ResponseSparkline checks={checks} />
              </View>
            )}

            {/* SSL */}
            {site?.ssl_status && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>SSL Certificate</Text>
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Expires</Text>
                  <Text style={[styles.infoValue, sslDaysLeft != null && sslDaysLeft < 14 ? { color: colors.warning } : null]}>
                    {sslDaysLeft != null ? `${sslDaysLeft} days` : '—'}
                    {site.ssl_status.expires_at ? ` (${new Date(site.ssl_status.expires_at).toLocaleDateString()})` : ''}
                  </Text>
                </View>
                {site.ssl_status.grade && (
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Grade</Text>
                    <Text style={styles.infoValue}>{site.ssl_status.grade}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Site info */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Site info</Text>
              {[
                ['WordPress', site?.wp_version  ?? 'Unknown'],
                ['PHP',       site?.php_version ?? 'Unknown'],
                ['Last check', site?.last_check_at ? new Date(site.last_check_at).toLocaleString() : 'Never'],
                ['Last health pull', site?.last_health_at ? new Date(site.last_health_at).toLocaleString() : 'Never'],
              ].map(([label, value]) => (
                <View key={label} style={styles.infoRow}>
                  <Text style={styles.infoLabel}>{label}</Text>
                  <Text style={styles.infoValue}>{value}</Text>
                </View>
              ))}
            </View>

            {/* Updates */}
            {updatePlugins.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>
                  Updates available ({updatePlugins.length})
                </Text>
                {updatePlugins.map(p => (
                  <View key={p.id} style={styles.infoRow}>
                    <Text style={styles.infoLabel} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.infoValue}>{p.version} → {p.new_version ?? '?'}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.content}>
            {/* Security score */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Security score</Text>
              <ScoreGauge score={site?.security_score ?? null} breakdown={site?.score_breakdown} />
            </View>

            {/* Vulnerable plugins */}
            {vulnPlugins.length > 0 && (
              <View style={styles.card}>
                <Text style={[styles.cardTitle, { color: colors.critical }]}>
                  Vulnerable plugins ({vulnPlugins.length})
                </Text>
                {vulnPlugins.map(p => (
                  <View key={p.id} style={[styles.infoRow, { alignItems: 'flex-start' }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.infoLabel, { color: colors.critical }]}>{p.name}</Text>
                      <Text style={styles.muted}>{p.version} · {p.active ? 'Active' : 'Inactive'}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Activity timeline */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Activity timeline</Text>
              {events.length === 0 && !isFetchingNextPage && (
                <Text style={styles.muted}>No events recorded yet.</Text>
              )}
              {events.map(ev => (
                <EventRow key={ev.id} event={ev} />
              ))}
              {hasNextPage && (
                <Pressable style={styles.loadMore} onPress={() => fetchNextPage()} disabled={isFetchingNextPage}>
                  {isFetchingNextPage
                    ? <ActivityIndicator color={colors.accent} size="small" />
                    : <Text style={styles.loadMoreText}>Load more</Text>
                  }
                </Pressable>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </>
  )
}

function EventRow({ event }: { event: SiteEvent }) {
  const color = severityColor(event.severity)
  const time  = new Date(event.occurred_at).toLocaleString()
  const actor = event.actor as Record<string, unknown> | null
  const data  = event.data  as Record<string, unknown> | null
  const geo   = event.geo

  const subtitle = (() => {
    if (actor?.user_login) return `User: ${actor.user_login}${geo ? ` · ${geo.city}, ${geo.countryCode}` : ''}`
    if (data?.plugin || data?.name) return String(data.plugin ?? data.name ?? '')
    if (data?.option) return `Option: ${data.option}`
    return ''
  })()

  return (
    <View style={styles.eventRow}>
      <View style={[styles.eventDot, { backgroundColor: color }]} />
      <View style={styles.eventBody}>
        <Text style={styles.eventType}>{event.type}</Text>
        {subtitle ? <Text style={styles.eventSub}>{subtitle}</Text> : null}
        <Text style={styles.eventTime}>{time}</Text>
      </View>
      {event.correlated_event_id && (
        <View style={styles.causeChip}>
          <Ionicons name="link-outline" size={10} color={colors.warning} />
          <Text style={styles.causeText}>Correlated</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: colors.bg },
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted:    { color: colors.muted, fontSize: 13 },
  header:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.md, backgroundColor: colors.surface },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headerRight:{ alignItems: 'flex-end', gap: 2 },
  status:   { fontSize: 13, fontWeight: '700', color: colors.text },
  respTime: { fontSize: 13, color: colors.muted },
  uptimePct:{ fontSize: 12, fontWeight: '600' },
  tabBar:   { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBtn:   { flex: 1, paddingVertical: spacing.md, alignItems: 'center' },
  tabActive:{ borderBottomWidth: 2, borderBottomColor: colors.accent },
  tabText:  { fontSize: 14, fontWeight: '500', color: colors.muted },
  tabTextActive: { color: colors.text },
  content:  { padding: spacing.md, gap: spacing.md },
  card:     { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cardHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:{ fontSize: 14, fontWeight: '600', color: colors.text },
  rangeRow: { flexDirection: 'row', gap: spacing.xs },
  rangeBtn: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.sm, backgroundColor: colors.surface2 },
  rangeBtnActive: { backgroundColor: colors.accent },
  rangeBtnText: { fontSize: 11, color: colors.muted, fontWeight: '500' },
  rangeBtnTextActive: { color: colors.text },
  infoRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel:{ fontSize: 13, color: colors.muted, flex: 1 },
  infoValue:{ fontSize: 13, color: colors.text, textAlign: 'right', flexShrink: 1, marginLeft: spacing.sm },
  eventRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  eventDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4, flexShrink: 0 },
  eventBody:{ flex: 1 },
  eventType:{ fontSize: 13, fontWeight: '500', color: colors.text },
  eventSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  eventTime:{ fontSize: 11, color: colors.dim, marginTop: 1 },
  causeChip:{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#422006', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10 },
  causeText:{ fontSize: 10, color: colors.warning },
  loadMore: { alignItems: 'center', paddingVertical: spacing.md },
  loadMoreText: { color: colors.accent, fontSize: 13 },
})
