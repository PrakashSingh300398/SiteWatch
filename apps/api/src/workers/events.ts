import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { redis } from '../lib/redis'
import { BULL_CONNECTION } from '../lib/queue'
import { geoLookup } from '../lib/geo'
import { createAlert } from '../lib/alerts'

// Spec §4.4: brute-force threshold
const BRUTE_WINDOW_MS = 15 * 60 * 1000
const BRUTE_THRESHOLD = 100

// Spec §4.4: 7-day learning window after pairing — seed known IPs without alerting
const LEARNING_WINDOW_MS = 7 * 24 * 3600 * 1000

export function startEventsWorker() {
  return new Worker(
    'events',
    async job => {
      const { siteId, eventIds } = job.data as { siteId: string; eventIds: string[] }

      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { id: true, org_id: true, name: true, paired_at: true },
      })
      if (!site) return

      const isLearning = site.paired_at
        ? Date.now() - site.paired_at.getTime() < LEARNING_WINDOW_MS
        : true

      const events = await prisma.event.findMany({
        where: { id: { in: eventIds } },
        orderBy: { occurred_at: 'asc' },
      })

      for (const ev of events) {
        const actor = (ev.actor ?? {}) as Record<string, unknown>
        const data  = (ev.data  ?? {}) as Record<string, unknown>

        // ── Geo enrichment ─────────────────────────────────────────────────
        if (ev.ip && ev.geo === null) {
          const geo = await geoLookup(ev.ip)
          if (geo) {
            await prisma.event.update({
              where: { id: ev.id },
              data: { geo: geo as unknown as Prisma.InputJsonValue },
            })
          }
        }

        // ── Rules engine ────────────────────────────────────────────────────
        await applyRule(ev.type, { ev, actor, data, site, isLearning })
      }
    },
    { connection: BULL_CONNECTION, concurrency: 5 },
  )
}

// ─── Per-type rule handlers ───────────────────────────────────────────────────

type Ev = Awaited<ReturnType<typeof prisma.event.findFirst>> & {}
type SiteCtx = { id: string; org_id: string; name: string }

async function applyRule(
  type: string,
  ctx: { ev: Ev; actor: Record<string, unknown>; data: Record<string, unknown>; site: SiteCtx; isLearning: boolean },
) {
  const { ev, actor, data, site, isLearning } = ctx

  switch (type) {
    case 'user.created': {
      const role = String(actor.role ?? data.role ?? '')
      if (role.includes('administrator')) {
        await createAlert(prisma, {
          siteId: site.id, orgId: site.org_id,
          rule: 'new_admin',
          severity: 'critical',
          title: `New administrator on ${site.name}`,
          body: `User "${actor.user_login ?? 'unknown'}" was created with administrator role`,
          eventId: ev!.id,
        })
      }
      break
    }

    case 'user.role_changed': {
      const newRole = String(data.new_role ?? '')
      if (newRole === 'administrator') {
        await createAlert(prisma, {
          siteId: site.id, orgId: site.org_id,
          rule: 'admin_role_granted',
          severity: 'critical',
          title: `User promoted to administrator on ${site.name}`,
          body: `"${data.user_login ?? 'unknown'}" was promoted from "${data.old_role ?? '?'}" to administrator`,
          eventId: ev!.id,
        })
      }
      break
    }

    case 'user.login_success': {
      const ip = ev!.ip ?? String(actor.ip ?? '')
      if (ip) await handleNewCountryLogin(ev!, actor, site, ip, isLearning)
      break
    }

    case 'user.login_failed': {
      await handleBruteForce(ev!, site)
      break
    }

    case 'plugin.deactivated': {
      await createAlert(prisma, {
        siteId: site.id, orgId: site.org_id,
        rule: 'plugin_deactivated',
        severity: 'warning',
        title: `Plugin deactivated on ${site.name}`,
        body: `Plugin "${data.name ?? data.plugin ?? 'unknown'}" was deactivated`,
        eventId: ev!.id,
      })
      break
    }

    case 'plugin.deleted': {
      await createAlert(prisma, {
        siteId: site.id, orgId: site.org_id,
        rule: 'plugin_deleted',
        severity: 'warning',
        title: `Plugin deleted on ${site.name}`,
        body: `Plugin "${data.plugin ?? 'unknown'}" was deleted`,
        eventId: ev!.id,
      })
      break
    }

    case 'option.changed': {
      await createAlert(prisma, {
        siteId: site.id, orgId: site.org_id,
        rule: 'option_changed',
        severity: 'warning',
        title: `Critical option changed on ${site.name}`,
        body: `Option "${data.option ?? 'unknown'}" changed to "${data.new_value ?? ''}"`,
        eventId: ev!.id,
      })
      break
    }

    case 'theme.switched': {
      await createAlert(prisma, {
        siteId: site.id, orgId: site.org_id,
        rule: 'theme_switched',
        severity: 'warning',
        title: `Theme switched on ${site.name}`,
        body: `Active theme changed to "${data.new_theme ?? 'unknown'}"`,
        eventId: ev!.id,
      })
      break
    }

    case 'theme.file_edited': {
      await createAlert(prisma, {
        siteId: site.id, orgId: site.org_id,
        rule: 'theme_file_edited',
        severity: 'warning',
        title: `Theme file edited on ${site.name}`,
        body: `"${data.file ?? 'unknown file'}" in theme "${data.theme ?? 'unknown'}" was edited via WP admin${data.user_login ? ` by ${data.user_login}` : ''}`,
        eventId: ev!.id,
      })
      break
    }

    case 'integrity.php_in_uploads': {
      const count = Number(data.count ?? 1)
      const sample = String(data.sample ?? '')
      await createAlert(prisma, {
        siteId: site.id, orgId: site.org_id,
        rule: 'integrity.php_in_uploads',
        severity: 'critical',
        title: `PHP file found in uploads on ${site.name}`,
        body: `${count} PHP file${count !== 1 ? 's' : ''} detected in wp-content/uploads/${sample ? ` (e.g. ${sample})` : ''} — possible malware upload.`,
        eventId: ev!.id,
      })
      break
    }

    case 'integrity.core_modified': {
      const count = Number(data.count ?? 1)
      const sample = String(data.sample ?? '')
      await createAlert(prisma, {
        siteId: site.id, orgId: site.org_id,
        rule: 'integrity.core_modified',
        severity: 'critical',
        title: `WP core file modified on ${site.name}`,
        body: `${count} WordPress core file${count !== 1 ? 's' : ''} have unexpected checksums${sample ? ` (e.g. ${sample})` : ''} — possible compromise.`,
        eventId: ev!.id,
      })
      break
    }
  }
}

// ─── New-country login detection ──────────────────────────────────────────────

async function handleNewCountryLogin(
  ev: Ev,
  actor: Record<string, unknown>,
  site: SiteCtx,
  ip: string,
  isLearning: boolean,
) {
  const userLogin = String(actor.user_login ?? '')
  if (!userLogin) return

  const geo = await geoLookup(ip)
  if (!geo) return

  // All known countries for this user on this site
  const knownIps = await prisma.knownIp.findMany({
    where: { site_id: site.id, user_login: userLogin },
    select: { country: true },
  })
  const knownCountries = new Set(knownIps.map(k => k.country).filter(Boolean) as string[])
  const isNewCountry = !knownCountries.has(geo.countryCode)

  // Upsert the IP record (learning window or not)
  await prisma.knownIp.upsert({
    where: { site_id_user_login_ip: { site_id: site.id, user_login: userLogin, ip } },
    create: {
      site_id: site.id,
      user_login: userLogin,
      ip,
      country: geo.countryCode,
      first_seen: ev!.occurred_at,
      last_seen:  ev!.occurred_at,
    },
    update: { country: geo.countryCode, last_seen: ev!.occurred_at },
  })

  if (isNewCountry && !isLearning) {
    await createAlert(prisma, {
      siteId: site.id, orgId: site.org_id,
      rule: 'new_country_login',
      severity: 'critical',
      title: `Login from new location on ${site.name}`,
      body: `User "${userLogin}" logged in from ${geo.country} (${geo.countryCode}) — first time seen from this country`,
      eventId: ev!.id,
    })
  }
}

// ─── Brute-force detection (sliding window) ───────────────────────────────────

async function handleBruteForce(ev: Ev, site: SiteCtx) {
  const ts  = ev!.occurred_at.getTime()
  const key = `bruteforce:${site.id}`

  // Sliding window: add this event's timestamp, remove entries older than BRUTE_WINDOW_MS
  await redis.zadd(key, ts, ev!.id)
  await redis.zremrangebyscore(key, '-inf', ts - BRUTE_WINDOW_MS)
  await redis.expire(key, Math.ceil(BRUTE_WINDOW_MS / 1000) + 120)

  const count = await redis.zcard(key)
  if (count > BRUTE_THRESHOLD) {
    await createAlert(prisma, {
      siteId: site.id, orgId: site.org_id,
      rule: 'brute_force',
      severity: 'warning',
      title: `Brute-force attack detected on ${site.name}`,
      body: `${count} failed login attempts in the last 15 minutes`,
      eventId: ev!.id,
    })
  }
}
