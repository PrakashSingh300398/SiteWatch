import React from 'react'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import { colors, spacing, radius, severityColor } from '../theme'
import type { Alert } from '../api/types'

interface Props {
  alert: Alert
  onPress: () => void
  onAck?: () => void
}

export function AlertItem({ alert, onPress, onAck }: Props) {
  const color = severityColor(alert.severity)
  const age = formatAge(alert.created_at)
  const isAcked = !!alert.acknowledged_at

  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      <View style={[styles.stripe, { backgroundColor: color }]} />

      <View style={styles.body}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>{alert.title}</Text>
          <Text style={styles.age}>{age}</Text>
        </View>
        <Text style={styles.bodyText} numberOfLines={2}>{alert.body}</Text>
        {alert.site && (
          <Text style={styles.site} numberOfLines={1}>↗ {alert.site.name}</Text>
        )}
      </View>

      {!isAcked && onAck && (
        <Pressable style={styles.ackBtn} onPress={onAck} hitSlop={8}>
          <Text style={styles.ackText}>Ack</Text>
        </Pressable>
      )}
      {isAcked && (
        <View style={styles.ackedBadge}>
          <Text style={styles.ackedText}>✓</Text>
        </View>
      )}
    </Pressable>
  )
}

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.75 },
  stripe: { width: 4, alignSelf: 'stretch' },
  body: { flex: 1, padding: spacing.md, gap: 3 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.text, flex: 1, marginRight: spacing.sm },
  age: { fontSize: 11, color: colors.muted, flexShrink: 0 },
  bodyText: { fontSize: 12, color: colors.muted, lineHeight: 16 },
  site: { fontSize: 11, color: colors.accent, marginTop: 2 },
  ackBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    backgroundColor: colors.surface2,
    borderRadius: radius.sm,
  },
  ackText: { fontSize: 11, color: colors.muted, fontWeight: '600' },
  ackedBadge: {
    paddingHorizontal: spacing.sm,
    marginRight: spacing.sm,
  },
  ackedText: { fontSize: 14, color: colors.up },
})
