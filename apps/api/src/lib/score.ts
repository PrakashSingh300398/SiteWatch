// Security score calculator — spec §4.5.
// Start at 100, subtract per-issue, floor at 0.

export interface ScoreChecklist {
  disallowFileEdit: boolean     // DISALLOW_FILE_EDIT constant set
  wpDebugOff: boolean           // WP_DEBUG is false
  noDefaultAdmin: boolean       // no user with login 'admin'
  xmlrpcDisabled: boolean       // XML-RPC endpoint disabled
  userRegistrationClosed: boolean
  defaultRole: string           // subscriber | contributor | author | editor | administrator
}

export interface ScoreInput {
  checklist: ScoreChecklist
  phpVersion: string | null
  wpUpdateAvailable: boolean
  wpSecurityRelease: boolean
  adminCount: number
  sslExpiresAt: Date | null
  activeVulnPlugins: number
  inactiveVulnPlugins: number
}

export interface ScoreResult {
  score: number
  breakdown: Record<string, number>
}

const ROLES_AUTHOR_OR_ABOVE = new Set(['author', 'editor', 'administrator'])

export function computeSecurityScore(input: ScoreInput): ScoreResult {
  const breakdown: Record<string, number> = {}
  let deductions = 0

  const deduct = (key: string, amount: number) => {
    breakdown[key] = -amount
    deductions += amount
  }

  // Vulnerable plugins: active −25 each (cap −40); inactive −10 each
  if (input.activeVulnPlugins > 0)   deduct('active_vuln_plugins',   Math.min(input.activeVulnPlugins   * 25, 40))
  if (input.inactiveVulnPlugins > 0) deduct('inactive_vuln_plugins', Math.min(input.inactiveVulnPlugins * 10, 20))

  // PHP version < 8.0
  if (input.phpVersion) {
    const major = parseInt(input.phpVersion.split('.')[0] ?? '0', 10)
    if (major < 8) deduct('php_outdated', 10)
  }

  // WP core update available
  if (input.wpUpdateAvailable) deduct('wp_update', input.wpSecurityRelease ? 20 : 10)

  // 'admin' username exists
  if (!input.checklist.noDefaultAdmin) deduct('admin_username', 10)

  // User registration open with default role ≥ author
  if (!input.checklist.userRegistrationClosed && ROLES_AUTHOR_OR_ABOVE.has(input.checklist.defaultRole)) {
    deduct('open_registration', 15)
  }

  // File editing enabled in wp-admin
  if (!input.checklist.disallowFileEdit) deduct('file_editing', 5)

  // WP_DEBUG on in production
  if (!input.checklist.wpDebugOff) deduct('wp_debug', 5)

  // XML-RPC enabled
  if (!input.checklist.xmlrpcDisabled) deduct('xmlrpc', 5)

  // SSL expiring within 14 days
  if (input.sslExpiresAt) {
    const daysLeft = (input.sslExpiresAt.getTime() - Date.now()) / 86_400_000
    if (daysLeft < 14) deduct('ssl_expiring', 10)
  }

  // More than 5 administrator accounts
  if (input.adminCount > 5) deduct('admin_count', 5)

  return { score: Math.max(0, 100 - deductions), breakdown }
}
