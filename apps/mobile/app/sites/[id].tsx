import React, { useState } from 'react'
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  RefreshControl, ActivityIndicator, Linking,
} from 'react-native'
import { useLocalSearchParams, Stack } from 'expo-router'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { api } from '../../src/api/client'
import { UptimeChart, ResponseSparkline } from '../../src/components/UptimeChart'
import { ScoreGauge } from '../../src/components/ScoreGauge'
import { StatusDot } from '../../src/components/StatusDot'
import { colors, spacing, radius, severityColor } from '../../src/theme'
import type { SiteDetail, UptimeCheck, SiteEvent, Plugin, FormMonitorRecord, WebVitalsRecord, WpUserRecord, SeoData, SeoAuditData } from '../../src/api/types'

type Tab = 'overview' | 'security' | 'forms' | 'vitals' | 'seo'

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

  const { data: formsData, isLoading: formsLoading, refetch: refetchForms } =
    useQuery({
      queryKey: ['forms', id],
      queryFn: () => api<FormMonitorRecord[]>(`/v1/sites/${id}/forms`),
      enabled: tab === 'forms',
    })

  const { data: vitalsData, isLoading: vitalsLoading, refetch: refetchVitals } =
    useQuery({
      queryKey: ['vitals', id],
      queryFn: () => api<WebVitalsRecord[]>(`/v1/sites/${id}/vitals`),
      enabled: tab === 'vitals',
    })

  const { data: seoData, isLoading: seoLoading, refetch: refetchSeo } =
    useQuery({
      queryKey: ['seo', id],
      queryFn: () => api<SeoData>(`/v1/sites/${id}/seo`),
      enabled: tab === 'seo',
    })

  const { data: auditData, isLoading: auditLoading, refetch: refetchAudit } =
    useQuery({
      queryKey: ['seo-audit', id],
      queryFn: () => api<SeoAuditData>(`/v1/sites/${id}/seo/audit`),
      enabled: tab === 'seo',
    })

  const usersData = site?.wp_users ?? []

  const site    = siteData?.site
  const checks  = uptimeData?.checks ?? []
  const events  = eventsData?.pages.flatMap(p => p.events) ?? []
  const plugins: Plugin[] = siteData?.site.plugins ?? []
  const vulnPlugins    = plugins.filter(p => p.vulnerable)
  const updatePlugins  = plugins.filter(p => p.update_available)

  const isRefreshing = siteLoading || uptimeLoading
  const onRefresh = async () => {
    await Promise.all([
      refetchSite(),
      refetchUptime(),
      tab === 'security' && refetchEvents(),
      tab === 'forms'    && refetchForms(),
      tab === 'vitals'   && refetchVitals(),
      tab === 'seo'      && Promise.all([refetchSeo(), refetchAudit()]),
    ])
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarInner}>
          {(['overview', 'security', 'forms', 'vitals', 'seo'] as Tab[]).map(t => (
            <Pressable key={t} style={[styles.tabBtn, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === 'seo' ? 'SEO' : t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

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
              {([
                ['WordPress', site?.wp_version  ?? 'Unknown'],
                ['PHP',       site?.php_version ?? 'Unknown'],
                ['Active theme', site?.active_theme
                  ? `${site.active_theme.name} v${site.active_theme.version}`
                  : 'Unknown'],
                ['Last check', site?.last_check_at ? new Date(site.last_check_at).toLocaleString() : 'Never'],
                ['Last health pull', site?.last_health_at ? new Date(site.last_health_at).toLocaleString() : 'Never'],
              ] as [string, string][]).map(([label, value]) => (
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
        ) : tab === 'security' ? (
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

            {/* Users */}
            {usersData && usersData.length > 0 && (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>Site users ({usersData.length})</Text>
                  <Text style={styles.muted}>Manage in WP Admin</Text>
                </View>
                {usersData.map(u => (
                  <View key={u.user_login} style={styles.infoRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.infoLabel}>{u.display_name || u.user_login}</Text>
                      <Text style={styles.muted}>{u.email}</Text>
                    </View>
                    <View style={[styles.roleChip, u.roles.includes('administrator') && styles.roleChipAdmin]}>
                      <Text style={styles.roleChipText}>{u.roles[0] ?? 'user'}</Text>
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
        ) : tab === 'forms' ? (
          <View style={styles.content}>
            {formsLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
            ) : !formsData || formsData.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.muted}>No form plugins detected. Install Gravity Forms, WPForms, or CF7 and update the WP plugin.</Text>
              </View>
            ) : (
              formsData.map(form => (
                <View key={form.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{form.form_name}</Text>
                    {form.alert_state === 'stopped' && (
                      <View style={styles.stoppedChip}>
                        <Text style={styles.stoppedText}>STOPPED</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.formPlugin}>{PLUGIN_LABELS[form.form_plugin]}</Text>
                  {[
                    ['Last 24h', String(form.count_24h)],
                    ['Last 7d', String(form.count_7d)],
                    ['Daily baseline', form.baseline_daily != null ? form.baseline_daily.toFixed(1) + '/day' : '—'],
                    ['Last entry', form.last_entry_at ? new Date(form.last_entry_at).toLocaleString() : 'Never'],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{label}</Text>
                      <Text style={[styles.infoValue, label === 'Last entry' && form.alert_state === 'stopped' ? { color: colors.warning } : null]}>{value}</Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        ) : tab === 'vitals' ? (
          <View style={styles.content}>
            {vitalsLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
            ) : !vitalsData || vitalsData.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.muted}>No Core Web Vitals data yet. Results appear after the weekly scan (requires PSI_API_KEY on the server).</Text>
              </View>
            ) : (
              vitalsData.map((v, i) => (
                <View key={v.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{i === 0 ? 'Latest' : new Date(v.measured_at).toLocaleDateString()}</Text>
                    {v.performance != null && (
                      <View style={[styles.scoreChip, { backgroundColor: scoreColor(v.performance) }]}>
                        <Text style={styles.scoreChipText}>{v.performance}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.formPlugin}>{v.strategy} · {new Date(v.measured_at).toLocaleString()}</Text>
                  {[
                    ['LCP', v.lcp_ms != null ? `${(v.lcp_ms / 1000).toFixed(2)}s` : '—'],
                    ['CLS', v.cls != null ? v.cls.toFixed(3) : '—'],
                    ['INP', v.inp_ms != null ? `${v.inp_ms}ms` : '—'],
                  ].map(([label, value]) => (
                    <View key={label} style={styles.infoRow}>
                      <Text style={styles.infoLabel}>{label}</Text>
                      <Text style={styles.infoValue}>{value}</Text>
                    </View>
                  ))}
                </View>
              ))
            )}
          </View>
        ) : (
          /* SEO tab */
          <View style={styles.content}>
            {seoLoading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
            ) : (
              <>
                {/* Connection card */}
                <View style={styles.card}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>Google Search Console</Text>
                    {seoData?.connection?.status === 'active' && (
                      <View style={styles.connectedChip}>
                        <Text style={styles.connectedText}>CONNECTED</Text>
                      </View>
                    )}
                  </View>
                  {seoData?.connection ? (
                    <>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Account</Text>
                        <Text style={styles.infoValue}>{seoData.connection.google_email}</Text>
                      </View>
                      <View style={styles.infoRow}>
                        <Text style={styles.infoLabel}>Property</Text>
                        <Text style={styles.infoValue} numberOfLines={1}>{seoData.connection.property_url}</Text>
                      </View>
                      {seoData.connection.status !== 'active' && (
                        <Text style={{ color: colors.warning, fontSize: 13, marginTop: spacing.xs }}>
                          Connection {seoData.connection.status}. Tap below to reconnect.
                        </Text>
                      )}
                    </>
                  ) : (
                    <Text style={[styles.muted, { marginBottom: spacing.sm }]}>
                      Connect your Google Search Console property to see clicks, impressions, and ranking data.
                    </Text>
                  )}
                  <Pressable
                    style={[styles.connectBtn, seoData?.connection?.status === 'active' && styles.connectBtnSecondary]}
                    onPress={async () => {
                      const result = await api<{ url: string }>(`/v1/sites/${id}/gsc/connect`)
                      await Linking.openURL(result.url)
                    }}
                  >
                    <Ionicons name="logo-google" size={16} color={colors.text} />
                    <Text style={styles.connectBtnText}>
                      {seoData?.connection?.status === 'active' ? 'Reconnect GSC' : 'Connect Google Search Console'}
                    </Text>
                  </Pressable>
                </View>

                {/* Traffic summary */}
                {seoData?.summary && seoData.summary.last7Clicks > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Traffic (last 7 days)</Text>
                    <View style={styles.seoMetricRow}>
                      <View style={styles.seoMetric}>
                        <Text style={styles.seoMetricValue}>{seoData.summary.last7Clicks.toLocaleString()}</Text>
                        <Text style={styles.seoMetricLabel}>Clicks</Text>
                      </View>
                      <View style={styles.seoMetricDivider} />
                      <View style={styles.seoMetric}>
                        {seoData.summary.clicksWoW != null ? (
                          <>
                            <Text style={[styles.seoMetricValue, { color: seoData.summary.clicksWoW >= 0 ? colors.up : colors.warning }]}>
                              {seoData.summary.clicksWoW >= 0 ? '+' : ''}{seoData.summary.clicksWoW.toFixed(1)}%
                            </Text>
                            <Text style={styles.seoMetricLabel}>vs prev 7d</Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.seoMetricValue}>—</Text>
                            <Text style={styles.seoMetricLabel}>vs prev 7d</Text>
                          </>
                        )}
                      </View>
                      <View style={styles.seoMetricDivider} />
                      <View style={styles.seoMetric}>
                        <Text style={styles.seoMetricValue}>{seoData.summary.prev7Clicks.toLocaleString()}</Text>
                        <Text style={styles.seoMetricLabel}>Prev 7d</Text>
                      </View>
                    </View>
                  </View>
                )}

                {/* Index status */}
                {seoData?.indexStatus && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Index coverage</Text>
                    {[
                      ['Indexed pages', String(seoData.indexStatus.indexed_count)],
                      ['Excluded (noindex)', String(seoData.indexStatus.excluded_noindex)],
                      ['Crawled, not indexed', String(seoData.indexStatus.crawled_not_indexed)],
                      ['Server errors', String(seoData.indexStatus.server_errors)],
                    ].map(([label, value]) => (
                      <View key={label} style={styles.infoRow}>
                        <Text style={styles.infoLabel}>{label}</Text>
                        <Text style={styles.infoValue}>{value}</Text>
                      </View>
                    ))}
                    <Text style={styles.seoDate}>Updated {new Date(seoData.indexStatus.date).toLocaleDateString()}</Text>
                  </View>
                )}

                {/* Top queries */}
                {seoData?.queries && seoData.queries.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Top queries (last 7d)</Text>
                    <View style={styles.queryHeader}>
                      <Text style={[styles.infoLabel, { flex: 3 }]}>Query</Text>
                      <Text style={[styles.infoLabel, { textAlign: 'right', width: 50 }]}>Clicks</Text>
                      <Text style={[styles.infoLabel, { textAlign: 'right', width: 55 }]}>Position</Text>
                    </View>
                    {seoData.queries.slice(0, 15).map((q, i) => (
                      <View key={i} style={[styles.queryRow, q.is_priority && styles.queryRowPriority]}>
                        <Text style={[styles.queryText, { flex: 3 }]} numberOfLines={1}>{q.query}</Text>
                        <Text style={[styles.queryNum, { width: 50 }]}>{q.clicks}</Text>
                        <Text style={[styles.queryNum, { width: 55 }]}>{q.position?.toFixed(1) ?? '—'}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Audit summary */}
                {auditData?.summary && (
                  <View style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.cardTitle}>Technical SEO audit</Text>
                      <View style={[styles.scoreChip, { backgroundColor: scoreColor(auditData.summary.score ?? 0) }]}>
                        <Text style={styles.scoreChipText}>{auditData.summary.score ?? '—'}</Text>
                      </View>
                    </View>
                    <Text style={styles.seoDate}>Crawled {new Date(auditData.summary.crawled_at).toLocaleDateString()}</Text>
                    {Object.entries(auditData.summary.issue_counts)
                      .filter(([, count]) => count > 0)
                      .sort(([, a], [, b]) => b - a)
                      .map(([issue, count]) => (
                        <View key={issue} style={styles.infoRow}>
                          <Text style={styles.infoLabel}>{ISSUE_LABELS[issue] ?? issue.replace(/_/g, ' ')}</Text>
                          <Text style={[styles.infoValue, ISSUE_CRITICAL.includes(issue) ? { color: colors.critical } : { color: colors.warning }]}>
                            {count}
                          </Text>
                        </View>
                      ))
                    }
                    <Pressable
                      style={[styles.connectBtn, styles.connectBtnSecondary, { marginTop: spacing.sm }]}
                      onPress={() => api(`/v1/sites/${id}/seo/crawl`, { method: 'POST' }).catch(() => null)}
                    >
                      <Ionicons name="refresh-outline" size={15} color={colors.text} />
                      <Text style={styles.connectBtnText}>Run crawl now</Text>
                    </Pressable>
                  </View>
                )}

                {/* Pages with issues */}
                {auditData?.pages && auditData.pages.filter(p => p.issues.length > 0).length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>Pages with issues</Text>
                    {auditData.pages
                      .filter(p => p.issues.length > 0)
                      .slice(0, 20)
                      .map((p, i) => (
                        <View key={i} style={[styles.pageIssueRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                          <Text style={styles.pageIssueUrl} numberOfLines={1}>{p.url.replace(/^https?:\/\/[^/]+/, '')}</Text>
                          <View style={styles.issueChips}>
                            {p.issues.slice(0, 3).map(issue => (
                              <View key={issue} style={[styles.issueChip, ISSUE_CRITICAL.includes(issue.split(':')[0]) && styles.issueChipCritical]}>
                                <Text style={styles.issueChipText}>{ISSUE_LABELS[issue.split(':')[0]] ?? issue.split(':')[0]}</Text>
                              </View>
                            ))}
                            {p.issues.length > 3 && <Text style={styles.muted}>+{p.issues.length - 3}</Text>}
                          </View>
                        </View>
                      ))
                    }
                  </View>
                )}

                {!auditData?.summary && !auditLoading && (
                  <View style={styles.card}>
                    <Text style={styles.muted}>No crawl data yet.</Text>
                    <Pressable
                      style={[styles.connectBtn, { marginTop: spacing.sm }]}
                      onPress={() => api(`/v1/sites/${id}/seo/crawl`, { method: 'POST' }).catch(() => null)}
                    >
                      <Ionicons name="search-outline" size={15} color={colors.text} />
                      <Text style={styles.connectBtnText}>Run first crawl</Text>
                    </Pressable>
                  </View>
                )}

                {!seoData?.connection && !seoLoading && !auditData?.summary && (
                  <View style={styles.card}>
                    <Text style={styles.muted}>Connect GSC above to see traffic data.</Text>
                  </View>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </>
  )
}

const PLUGIN_LABELS: Record<string, string> = {
  gravityforms: 'Gravity Forms',
  wpforms: 'WPForms',
  cf7: 'Contact Form 7',
}

const ISSUE_LABELS: Record<string, string> = {
  missing_title:     'Missing title',
  title_too_long:    'Title too long',
  missing_meta_desc: 'Missing meta desc',
  meta_desc_too_long:'Meta desc too long',
  missing_h1:        'Missing H1',
  noindex:           'Noindex',
  nofollow:          'Nofollow',
  broken_link:       'Broken link',
  redirect_chain:    'Redirect chain',
  external_canonical:'External canonical',
  missing_sitemap:   'No sitemap',
  missing_alt:       'Missing alt text',
  timeout:           'Timeout',
}

const ISSUE_CRITICAL = ['noindex', 'broken_link', 'missing_title', 'missing_sitemap']

function scoreColor(score: number) {
  if (score >= 90) return '#166534'
  if (score >= 50) return '#713f12'
  return '#7f1d1d'
}

function EventRow({ event }: { event: SiteEvent }) {
  const color = severityColor(event.severity)
  const time  = new Date(event.occurred_at).toLocaleString()
  const actor = event.actor as Record<string, unknown> | null
  const data  = event.data  as Record<string, unknown> | null
  const geo   = event.geo

  const subtitle = (() => {
    if (actor?.user_login) return `User: ${actor.user_login}${geo ? ` · ${geo.city}, ${geo.countryCode}` : ''}`
    // Plugin events: prefer resolved name, fall back to parsing file path
    if (data?.name) return String(data.name)
    if (data?.plugins) {
      const paths = data.plugins as string[]
      if (paths.length > 0) {
        const names = paths.map(p => {
          const folder = p.split('/')[0]
          return folder.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        })
        return names.join(', ')
      }
    }
    if (data?.plugin) return String(data.plugin)
    // Theme events
    if (data?.file && data?.theme) return `${data.theme}: ${data.file}${data.user_login ? ` by ${data.user_login}` : ''}`
    if (data?.new_theme) return `→ ${data.new_theme}`
    if (data?.option)  return `Option: ${data.option}`
    if (data?.version) return `v${data.version}`
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
  tabBar:   { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
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
  roleChip:      { backgroundColor: '#1e293b', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  roleChipAdmin: { backgroundColor: '#7f1d1d' },
  roleChipText:  { fontSize: 11, color: '#94a3b8', fontWeight: '600' },
  stoppedChip: { backgroundColor: '#7f1d1d', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  stoppedText: { fontSize: 10, fontWeight: '700', color: '#fca5a5' },
  formPlugin: { fontSize: 11, color: colors.muted, marginBottom: 4 },
  scoreChip:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  scoreChipText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  tabBarInner: { flexDirection: 'row' },
  // SEO tab styles
  connectedChip:    { backgroundColor: '#14532d', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  connectedText:    { fontSize: 10, fontWeight: '700', color: '#86efac' },
  connectBtn:       { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.accent, borderRadius: radius.sm, padding: spacing.sm, justifyContent: 'center', marginTop: spacing.sm },
  connectBtnSecondary: { backgroundColor: colors.surface2 },
  connectBtnText:   { fontSize: 13, fontWeight: '600', color: colors.text },
  seoMetricRow:     { flexDirection: 'row', marginTop: spacing.sm },
  seoMetric:        { flex: 1, alignItems: 'center', gap: 4 },
  seoMetricDivider: { width: 1, backgroundColor: colors.border },
  seoMetricValue:   { fontSize: 22, fontWeight: '700', color: colors.text },
  seoMetricLabel:   { fontSize: 11, color: colors.muted },
  seoDate:          { fontSize: 11, color: colors.dim, marginTop: spacing.xs },
  queryHeader:      { flexDirection: 'row', paddingBottom: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 2 },
  queryRow:         { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: colors.border },
  queryRowPriority: { backgroundColor: '#1e1e3f' },
  queryText:        { fontSize: 12, color: colors.text },
  queryNum:         { fontSize: 12, color: colors.muted, textAlign: 'right' },
  pageIssueRow:     { paddingVertical: spacing.sm, gap: 4 },
  pageIssueUrl:     { fontSize: 12, color: colors.muted },
  issueChips:       { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  issueChip:        { backgroundColor: '#422006', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  issueChipCritical:{ backgroundColor: '#7f1d1d' },
  issueChipText:    { fontSize: 10, fontWeight: '600', color: '#fca5a5' },
})
