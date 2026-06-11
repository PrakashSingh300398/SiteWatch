import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { BULL_CONNECTION } from '../lib/queue'
import { createAlert, resolveAlert } from '../lib/alerts'

const THREE_DAYS_MS = 3 * 24 * 3600 * 1000

export function startFormsWorker() {
  return new Worker(
    'forms',
    async job => {
      if (job.name === 'forms.watch') await runFormsWatch()
    },
    { connection: BULL_CONNECTION, concurrency: 1 },
  )
}

export async function runFormsWatch() {
  const now = new Date()
  const threeDaysAgo = new Date(now.getTime() - THREE_DAYS_MS)

  const monitors = await prisma.formMonitor.findMany({
    where: { baseline_daily: { gte: 1 } },
    include: { site: { select: { id: true, org_id: true, name: true } } },
  })

  for (const monitor of monitors) {
    const isStopped =
      monitor.last_entry_at === null ||
      monitor.last_entry_at < threeDaysAgo

    const rule = `form.stopped.${monitor.form_plugin}.${monitor.form_id}`

    if (isStopped && monitor.alert_state !== 'stopped') {
      const baseline = monitor.baseline_daily ? Number(monitor.baseline_daily).toFixed(1) : '?'
      await createAlert(prisma, {
        siteId:   monitor.site_id,
        orgId:    monitor.site.org_id,
        rule,
        severity: 'warning',
        title:    `Form submissions stopped: ${monitor.form_name}`,
        body:     `"${monitor.form_name}" on ${monitor.site.name} has had no submissions for 3+ days. Baseline: ${baseline}/day.`,
      })
      await prisma.formMonitor.update({
        where: { id: monitor.id },
        data:  { alert_state: 'stopped' },
      })
    } else if (!isStopped && monitor.alert_state === 'stopped') {
      await resolveAlert(prisma, monitor.site_id, rule)
      await prisma.formMonitor.update({
        where: { id: monitor.id },
        data:  { alert_state: null },
      })
    }
  }
}
