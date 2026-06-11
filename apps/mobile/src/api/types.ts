export interface AuthUser {
  id: string
  email: string
  role: string
  orgId: string
}

// Base site fields shared by list and detail responses
export interface SiteBase {
  id: string
  org_id: string
  url: string
  name: string
  status: 'up' | 'down' | 'unknown'
  paired_at: string | null
  last_check_at: string | null
  last_health_at: string | null
  wp_version: string | null
  php_version: string | null
  security_score: number | null
  score_breakdown: Record<string, number> | null
  check_interval_sec: number
  created_at: string
  ssl_status?: { expires_at: string | null; grade: string | null }
  active_theme?: { name: string; slug: string; version: string } | null
  wp_users?: WpUserRecord[]
}

// GET /v1/sites — list with uptime stats; plugins are update-available count only
export interface Site extends SiteBase {
  uptime_pct_24h: number | null
  last_response_ms: number | null
  alerts?: Array<{ severity: 'info' | 'warning' | 'critical' }>
  plugins?: Array<{ id: string }>
}

// GET /v1/sites/:id — detail with full plugin objects
export interface SiteDetail extends SiteBase {
  plugins: Plugin[]
}

export interface Alert {
  id: string
  site_id: string
  org_id: string
  rule: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  created_at: string
  acknowledged_at: string | null
  resolved_at: string | null
  event_id: string | null
  site?: { id: string; name: string; url: string }
}

export interface UptimeCheck {
  checked_at: string
  ok: boolean
  response_ms: number | null
  status_code: number | null
}

export interface SiteEvent {
  id: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  occurred_at: string
  actor: Record<string, unknown> | null
  data: Record<string, unknown> | null
  ip: string | null
  geo: { country: string; countryCode: string; city: string } | null
  correlated_event_id: string | null
  alerts: Array<{ id: string; rule: string }>
}

export interface Plugin {
  id: string
  slug: string
  name: string
  version: string | null
  active: boolean
  update_available: boolean
  new_version: string | null
  vulnerable: boolean
}

export interface DashboardData {
  sites: { total: number; up: number; down: number; unknown: number }
  alerts: { open: Record<string, number> }
  ssl: { expiringSoon: number }
  updates: { pending: number }
}

export interface WpUserRecord {
  user_login: string
  display_name: string
  email: string
  roles: string[]
  registered: string
}

export interface FormMonitorRecord {
  id: string
  form_plugin: 'gravityforms' | 'wpforms' | 'cf7'
  form_id: string
  form_name: string
  count_24h: number
  count_7d: number
  last_entry_at: string | null
  baseline_daily: number | null
  alert_state: string | null
}

export interface WebVitalsRecord {
  id: string
  performance: number | null
  lcp_ms: number | null
  cls: number | null
  inp_ms: number | null
  strategy: 'mobile' | 'desktop'
  measured_at: string
}
