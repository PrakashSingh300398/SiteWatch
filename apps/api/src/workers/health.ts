import { Worker } from 'bullmq'
import crypto from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { BULL_CONNECTION, vulnQueue } from '../lib/queue'
import { computeSecurityScore } from '../lib/score'

interface WpPlugin {
  slug: string
  name: string
  version?: string | null
  active: boolean
  update_available: boolean
  new_version?: string | null
}

interface WpForm {
  plugin: 'gravityforms' | 'wpforms' | 'cf7'
  form_id: string
  form_name: string
  count_24h: number | null
  count_7d: number | null
  last_entry_at: string | null
}

interface WpUser {
  user_login: string
  display_name: string
  email: string
  roles: string[]
  registered: string
}

interface HealthSnapshot {
  wp_version?: string
  wp_update_available?: string | null
  php_version?: string
  plugins?: WpPlugin[]
  administrators?: Array<{ user_login: string }>
  users?: WpUser[]
  active_theme?: { name: string; slug: string; version: string }
  security?: {
    disallow_file_edit?: boolean
    wp_debug_on?: boolean
    default_admin_exists?: boolean
    xmlrpc_enabled?: boolean
    user_registration_open?: boolean
    default_role?: string
  }
  forms?: WpForm[]
}

export function startHealthWorker() {
  return new Worker(
    'health',
    async job => {
      const { siteId } = job.data as { siteId: string }

      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: {
          id: true,
          url: true,
          site_key_hash: true,
          ssl_status: { select: { expires_at: true } },
        },
      })
      if (!site?.site_key_hash) return

      // HMAC-sign GET request — empty body so message = "${ts}."
      const ts  = Date.now()
      const sig = `sha256=${crypto
        .createHmac('sha256', site.site_key_hash)
        .update(`${ts}.`)
        .digest('hex')}`

      let snapshot: HealthSnapshot
      try {
        const resp = await fetch(`${site.url}/wp-json/sitewatch/v1/health`, {
          headers: {
            'X-SiteWatch-Signature': sig,
            'X-SiteWatch-Timestamp': String(ts),
            'X-SiteWatch-Site-Id': site.id,
          },
          signal: AbortSignal.timeout(30_000),
        })
        if (!resp.ok) {
          console.warn(`[health.pull] ${siteId}: HTTP ${resp.status}`)
          return
        }
        snapshot = await resp.json() as HealthSnapshot
      } catch (err) {
        console.warn(`[health.pull] ${siteId}: fetch error`, (err as Error).message)
        return
      }

      // ── Upsert plugins ────────────────────────────────────────────────────
      for (const p of snapshot.plugins ?? []) {
        await prisma.plugin.upsert({
          where: { site_id_slug: { site_id: siteId, slug: p.slug } },
          create: {
            site_id: siteId,
            slug: p.slug,
            name: p.name,
            version: p.version ?? null,
            active: p.active,
            update_available: p.update_available,
            new_version: p.new_version ?? null,
            last_seen_at: new Date(),
          },
          update: {
            name: p.name,
            version: p.version ?? null,
            active: p.active,
            update_available: p.update_available,
            new_version: p.new_version ?? null,
            last_seen_at: new Date(),
          },
        })
      }

      // ── Update site core metadata ─────────────────────────────────────────
      await prisma.site.update({
        where: { id: siteId },
        data: {
          wp_version:     snapshot.wp_version  ?? null,
          php_version:    snapshot.php_version ?? null,
          last_health_at: new Date(),
          wp_users:       (snapshot.users        ?? [])   as unknown as Prisma.InputJsonValue,
          active_theme:   (snapshot.active_theme ?? null) as unknown as Prisma.InputJsonValue,
        },
      })

      // ── Compute security score ────────────────────────────────────────────
      const vulnPlugins = await prisma.plugin.findMany({
        where: { site_id: siteId, vulnerable: true },
        select: { active: true },
      })
      const sec    = snapshot.security ?? {}
      const admins = snapshot.administrators ?? []

      const { score, breakdown } = computeSecurityScore({
        checklist: {
          disallowFileEdit:      !!sec.disallow_file_edit,
          wpDebugOff:            !sec.wp_debug_on,
          noDefaultAdmin:        !sec.default_admin_exists,
          xmlrpcDisabled:        !sec.xmlrpc_enabled,
          userRegistrationClosed:!sec.user_registration_open,
          defaultRole:           sec.default_role ?? 'subscriber',
        },
        phpVersion:         snapshot.php_version ?? null,
        wpUpdateAvailable:  !!snapshot.wp_update_available,
        wpSecurityRelease:  false, // Phase 2: detect via WP API
        adminCount:         admins.length,
        sslExpiresAt:       site.ssl_status?.expires_at ?? null,
        activeVulnPlugins:  vulnPlugins.filter(p =>  p.active).length,
        inactiveVulnPlugins:vulnPlugins.filter(p => !p.active).length,
      })

      await prisma.site.update({
        where: { id: siteId },
        data: {
          security_score:  score,
          score_breakdown: breakdown as Prisma.InputJsonValue,
        },
      })

      // ── Upsert form monitors ──────────────────────────────────────────────
      for (const f of snapshot.forms ?? []) {
        const count24 = f.count_24h ?? 0
        const count7  = f.count_7d  ?? 0
        // baseline_daily: rolling estimate from 7-day window
        const baseline = count7 > 0 ? count7 / 7 : undefined
        await prisma.formMonitor.upsert({
          where: { site_id_form_plugin_form_id: { site_id: siteId, form_plugin: f.plugin, form_id: f.form_id } },
          create: {
            site_id:       siteId,
            form_plugin:   f.plugin,
            form_id:       f.form_id,
            form_name:     f.form_name,
            count_24h:     count24,
            count_7d:      count7,
            last_entry_at: f.last_entry_at ? new Date(f.last_entry_at) : null,
            baseline_daily: baseline,
          },
          update: {
            form_name:     f.form_name,
            count_24h:     count24,
            count_7d:      count7,
            last_entry_at: f.last_entry_at ? new Date(f.last_entry_at) : null,
            ...(baseline !== undefined && { baseline_daily: baseline }),
          },
        })
      }

      // ── Dispatch vuln scan for this site's distinct slugs ─────────────────
      const slugs = (snapshot.plugins ?? []).map(p => p.slug)
      if (slugs.length > 0) {
        await vulnQueue.add(
          'vuln.scan',
          { siteId, slugs },
          { jobId: `vuln:${siteId}:${new Date().toISOString().slice(0, 10)}`, attempts: 2 },
        )
      }
    },
    { connection: BULL_CONNECTION, concurrency: 5 },
  )
}
