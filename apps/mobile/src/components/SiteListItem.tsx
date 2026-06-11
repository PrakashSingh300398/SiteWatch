import React from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import { StatusDot } from './StatusDot'
import { colors, spacing, radius } from '../theme'
import type { Site } from '../api/types'

interface Props {
  site: Site
  onPress: () => void
}

export function SiteListItem({ site, onPress }: Props) {
  const openAlerts = site.alerts ?? []
  const hasCritical = openAlerts.some(a => a.severity === 'critical')
  const hasWarning  = openAlerts.some(a => a.severity === 'warning')
  const updateCount = site.plugins?.length ?? 0

  const domain = (() => {
    try { return new URL(site.url).hostname } catch { return site.url }
  })()

  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      <StatusDot status={site.status} size={12} />

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{site.name}</Text>
        <Text style={styles.domain} numberOfLines={1}>{domain}</Text>
      </View>

      <View style={styles.stats}>
        {site.uptime_pct_24h != null && (
          <Text style={[styles.stat, { color: site.uptime_pct_24h < 99 ? colors.warning : colors.muted }]}>
            {site.uptime_pct_24h.toFixed(1)}%
          </Text>
        )}
        {site.last_response_ms != null && (
          <Text style={styles.stat}>{site.last_response_ms}ms</Text>
        )}
      </View>

      <View style={styles.badges}>
        {hasCritical && <View style={[styles.badge, { backgroundColor: colors.critical }]}><Text style={styles.badgeText}>!</Text></View>}
        {!hasCritical && hasWarning && <View style={[styles.badge, { backgroundColor: colors.warning }]}><Text style={styles.badgeText}>!</Text></View>}
        {updateCount > 0 && (
          <View style={[styles.badge, { backgroundColor: colors.surface2 }]}>
            <Text style={[styles.badgeText, { color: colors.muted }]}>{updateCount}↑</Text>
          </View>
        )}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  domain: { fontSize: 12, color: colors.muted, marginTop: 1 },
  stats: { alignItems: 'flex-end', gap: 2 },
  stat: { fontSize: 12, color: colors.muted },
  badges: { flexDirection: 'row', gap: 4 },
  badge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontWeight: '700', color: colors.text },
})
