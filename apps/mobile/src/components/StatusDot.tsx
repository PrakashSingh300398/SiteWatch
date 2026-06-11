import React from 'react'
import { View, StyleSheet } from 'react-native'
import { statusColor } from '../theme'

interface Props {
  status: string
  size?: number
}

export function StatusDot({ status, size = 10 }: Props) {
  return (
    <View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: statusColor(status) },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  dot: { flexShrink: 0 },
})
