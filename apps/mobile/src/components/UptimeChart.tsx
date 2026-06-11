import React from 'react'
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native'
import Svg, { Rect, Polyline } from 'react-native-svg'
import { colors, spacing } from '../theme'
import type { UptimeCheck } from '../api/types'

interface Props {
  checks: UptimeCheck[]
  height?: number
}

export function UptimeChart({ checks, height = 36 }: Props) {
  const { width } = useWindowDimensions()
  const chartWidth = width - spacing.md * 2 - 32  // account for container padding

  if (checks.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={styles.emptyText}>No data yet</Text>
      </View>
    )
  }

  // Show last 72 checks as bars
  const visible = checks.slice(-72)
  const barW = Math.max(1, chartWidth / visible.length - 1)
  const gap  = Math.max(0, (chartWidth - visible.length * barW) / Math.max(1, visible.length - 1))

  return (
    <Svg width={chartWidth} height={height}>
      {visible.map((c, i) => (
        <Rect
          key={i}
          x={i * (barW + gap)}
          y={0}
          width={barW}
          height={height}
          fill={c.ok ? colors.up : colors.down}
          opacity={0.85}
        />
      ))}
    </Svg>
  )
}

interface SparklineProps {
  checks: UptimeCheck[]
  height?: number
}

export function ResponseSparkline({ checks, height = 36 }: SparklineProps) {
  const { width } = useWindowDimensions()
  const chartWidth = width - spacing.md * 2 - 32

  const withMs = checks.filter(c => c.response_ms != null).slice(-72)
  if (withMs.length < 2) return null

  const maxMs = Math.max(...withMs.map(c => c.response_ms!), 1)

  const points = withMs
    .map((c, i) => {
      const x = (i / (withMs.length - 1)) * chartWidth
      const y = height - (c.response_ms! / maxMs) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <Svg width={chartWidth} height={height}>
      <Polyline points={points} stroke={colors.accent} fill="none" strokeWidth={1.5} />
    </Svg>
  )
}

const styles = StyleSheet.create({
  empty: {
    backgroundColor: colors.surface2,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: { fontSize: 11, color: colors.dim },
})
