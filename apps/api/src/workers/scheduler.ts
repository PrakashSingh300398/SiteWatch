import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { uptimeQueue, sslQueue, schedulerQueue, BULL_CONNECTION } from '../lib/queue'

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

      const sites = await prisma.site.findMany({
        where: { paired_at: { not: null } },
        select: {
          id: true,
          check_interval_sec: true,
          last_check_at: true,
          ssl_status: { select: { last_checked_at: true } },
        },
      })

      for (const site of sites) {
        // ── Uptime: due if never checked or interval elapsed ───────────────
        const intervalMs = site.check_interval_sec * 1000
        const lastMs = site.last_check_at?.getTime() ?? 0
        if (now - lastMs >= intervalMs) {
          // jobId bucketed by time-slot → deduplicates within the same interval window
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
      }
    },
    { connection: BULL_CONNECTION, concurrency: 1 },
  )
}
