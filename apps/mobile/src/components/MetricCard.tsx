import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, radius, spacing } from '../theme'

interface Props {
  label: string
  value: string | number
  accent?: string
  sub?: string
}

export function MetricCard({ label, value, accent, sub }: Props) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    minWidth: 80,
  },
  value: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.text,
  },
  label: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
    textAlign: 'center',
  },
  sub: {
    fontSize: 10,
    color: colors.dim,
    marginTop: 1,
  },
})
