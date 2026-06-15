import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { uptimeQueue, sslQueue, schedulerQueue, healthQueue, formsQueue, vitalsQueue, digestQueue, gscQueue, BULL_CONNECTION } from '../lib/queue'

export async function startScheduler() {
  // Register the repeatable trigger — idempotent on restart
  const repeatables = await schedulerQueue.getRepeatableJobs()
  if (!repeatables.some(r => r.name === 'scheduler.tick')) {
    await schedulerQueue.add('scheduler.tick', {}, {
      repeat: { every: 30_000 }, // every 30 s
    })
  }

  return new Worker(
    'scheduler',
    async () => {
      const now = Date.now()
      const todayStr = new Date().toISOString().slice(0, 10) // 'YYYY-MM-DD'

      // ── Digest: once per calendar day at org's configured hour (UTC) ──────
      const currentHour = new Date().getUTCHours()
      const todayStart  = new Date(now); todayStart.setUTCHours(0, 0, 0, 0)
      const orgs = await prisma.organization.findMany({
        select: { id: true, digest_hour: true, last_digest_at: true },
      })
      for (const org of orgs) {
        const notSentToday = !org.last_digest_at || org.last_digest_at < todayStart
        if (notSentToday && currentHour >= org.digest_hour) {
          await digestQueue.add(
            'digest.daily',
            { orgId: org.id },
            { jobId: `digest:${org.id}:${todayStr}` },
          )
        }
      }

      const sites = await prisma.site.findMany({
        where: { paired_at: { not: null } },
        select: {
          id: true,
          check_interval_sec: true,
          last_check_at: true,
          last_health_at: true,
          ssl_status: { select: { last_checked_at: true } },
        },
      })

      // ── forms.watch: one global job per hour ───────────────────────────────
      const ONE_HOUR_MS = 3600 * 1000
      const formsSlot   = Math.floor(now / ONE_HOUR_MS)
      await formsQueue.add('forms.watch', {}, { jobId: `forms:watch:${formsSlot}` })

      // ── vitals.fetch: need last measured_at per site ───────────────────────
      const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000
      const lastVitalsRows = await prisma.webVitals.groupBy({
        by: ['site_id'],
        _max: { measured_at: true },
      })
      const lastVitalsMap = new Map(
        lastVitalsRows.map(r => [r.site_id, r._max.measured_at?.getTime() ?? 0]),
      )

      for (const site of sites) {
        // ── Uptime: due if never checked or interval elapsed ───────────────
        const intervalMs = site.check_interval_sec * 1000
        const lastMs = site.last_check_at?.getTime() ?? 0
        if (now - lastMs >= intervalMs) {
          const slot = Math.floor(now / intervalMs)
          await uptimeQueue.add(
            'uptime.check',
            { siteId: site.id },
            { jobId: `uptime:${site.id}:${slot}` },
          )
        }

        // ── SSL: once per calendar day ─────────────────────────────────────
        const lastSslDate = site.ssl_status?.last_checked_at?.toISOString().slice(0, 10)
        if (lastSslDate !== todayStr) {
          await sslQueue.add(
            'ssl.check',
            { siteId: site.id },
            { jobId: `ssl:${site.id}:${todayStr}` },
          )
        }

        // ── Health pull: every 6 hours ─────────────────────────────────────
        const SIX_HOURS_MS = 6 * 3600 * 1000
        const lastHealthMs = site.last_health_at?.getTime() ?? 0
        if (now - lastHealthMs >= SIX_HOURS_MS) {
          const slot6h = Math.floor(now / SIX_HOURS_MS)
          await healthQueue.add(
            'health.pull',
            { siteId: site.id },
            { jobId: `health:${site.id}:${slot6h}` },
          )
        }

        // ── Vitals fetch: once per week ────────────────────────────────────
        const lastVitalsMs = lastVitalsMap.get(site.id) ?? 0
        if (now - lastVitalsMs >= SEVEN_DAYS_MS) {
          const weekSlot = Math.floor(now / SEVEN_DAYS_MS)
          await vitalsQueue.add(
            'vitals.fetch',
            { siteId: site.id },
            { jobId: `vitals:${site.id}:${weekSlot}` },
          )
        }
      }

      // ── GSC pull: once per calendar day for connected sites ───────────────
      const gscSites = await prisma.gscConnection.findMany({
        where: { status: 'active' },
        select: { site_id: true },
      })
      for (const { site_id } of gscSites) {
        await gscQueue.add(
          'gsc.pull',
          { siteId: site_id },
          { jobId: `gsc:${site_id}:${todayStr}` },
        )
      }
    },
    { connection: BULL_CONNECTION, concurrency: 1 },
  )
}
