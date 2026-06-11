export const colors = {
  // Status
  up:       '#22c55e',
  warning:  '#f59e0b',
  down:     '#ef4444',
  unknown:  '#64748b',
  critical: '#ef4444',
  info:     '#3b82f6',

  // Backgrounds
  bg:       '#0f172a',
  surface:  '#1e293b',
  surface2: '#334155',
  border:   '#334155',

  // Text
  text:     '#f1f5f9',
  muted:    '#94a3b8',
  dim:      '#64748b',

  // Accent
  accent:   '#3b82f6',
  accentDim:'#1d4ed8',
} as const

export const spacing = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32,
} as const

export const radius = {
  sm: 6, md: 10, lg: 16,
} as const

export function severityColor(s: 'info' | 'warning' | 'critical' | string) {
  if (s === 'critical') return colors.critical
  if (s === 'warning')  return colors.warning
  return colors.info
}

export function statusColor(s: 'up' | 'down' | 'unknown' | string) {
  if (s === 'up')   return colors.up
  if (s === 'down') return colors.down
  return colors.unknown
}
