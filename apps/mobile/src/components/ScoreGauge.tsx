import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { colors, radius, spacing } from '../theme'

interface Props {
  score: number | null
  breakdown?: Record<string, number> | null
}

function scoreColor(s: number) {
  if (s >= 80) return colors.up
  if (s >= 50) return colors.warning
  return colors.down
}

const LABELS: Record<string, string> = {
  active_vuln_plugins:   'Active vulnerable plugins',
  inactive_vuln_plugins: 'Inactive vulnerable plugins',
  php_outdated:          'PHP version < 8.0',
  wp_update:             'WordPress update available',
  admin_username:        '"admin" username exists',
  open_registration:     'Open user registration',
  file_editing:          'File editing enabled',
  wp_debug:              'WP_DEBUG on',
  xmlrpc:                'XML-RPC enabled',
  ssl_expiring:          'SSL expires within 14 days',
  admin_count:           'More than 5 admin accounts',
}

export function ScoreGauge({ score, breakdown }: Props) {
  if (score == null) {
    return (
      <View style={styles.container}>
        <Text style={styles.na}>Score not yet available</Text>
        <Text style={styles.naSub}>Will calculate after first health pull</Text>
      </View>
    )
  }

  const color = scoreColor(score)
  const issues = breakdown
    ? Object.entries(breakdown).filter(([, v]) => v < 0)
    : []

  return (
    <View style={styles.container}>
      <View style={styles.scoreRow}>
        <Text style={[styles.score, { color }]}>{score}</Text>
        <Text style={styles.outOf}>/100</Text>
      </View>

      {issues.length > 0 && (
        <View style={styles.issues}>
          {issues.map(([key, val]) => (
            <View key={key} style={styles.issue}>
              <Text style={styles.issueLabel}>{LABELS[key] ?? key}</Text>
              <Text style={[styles.issueVal, { color: colors.down }]}>{val}</Text>
            </View>
          ))}
        </View>
      )}

      {issues.length === 0 && (
        <Text style={styles.perfect}>No security issues detected</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { paddingVertical: spacing.sm },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: spacing.sm },
  score: { fontSize: 52, fontWeight: '800', lineHeight: 56 },
  outOf: { fontSize: 18, color: colors.muted, marginLeft: spacing.xs },
  issues: { gap: spacing.xs },
  issue: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  issueLabel: { fontSize: 13, color: colors.text, flex: 1 },
  issueVal: { fontSize: 13, fontWeight: '600' },
  perfect: { fontSize: 13, color: colors.up },
  na: { fontSize: 15, color: colors.muted },
  naSub: { fontSize: 12, color: colors.dim, marginTop: 4 },
})
