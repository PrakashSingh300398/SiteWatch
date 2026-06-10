import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { uptimeQueue, BULL_CONNECTION } from '../lib/queue'
import { createAlert, resolveAlert } from '../lib/alerts'
import { sendPushToOrg } from '../lib/push'

// ─── Flapping suppression ─────────────────────────────────────────────────────
// Max 1 down alert per 30 minutes per site (spec §4.4 dedup rule)
const FLAP_KEY = (siteId: string) => `uptime:flap:${siteId}`
const FLAP_TTL_SEC = 30 * 60

// First-failure retry sentinel — set when 1st check fails, cleared on recovery or 2nd failure
const RETRY_KEY = (siteId: string) => `uptime:retry:${siteId}`
const RETRY_TTL_SEC = 5 * 60

// ─── HTTP check ───────────────────────────────────────────────────────────────

interface CheckResult {
  ok: boolean
  statusCode: number | null
  responseMs: number
  error: string | null
}

async function httpCheck(url: string): Promise<CheckResult> {
  const t0 = Date.now()
  try {
    // AbortSignal.timeout available in Node 17.3+ (we require Node 20)
    const resp = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
      headers: { 'User-Agent': 'SiteWatch-Monitor/1.0' },
    })
    return {
      ok: resp.status >= 200 && resp.status < 400,
      statusCode: resp.status,
      responseMs: Date.now() - t0,
      error: null,
    }
  } catch (err: unknown) {
    return {
      ok: false,
      statusCode: null,
      responseMs: Date.now() - t0,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

export function startUptimeWorker() {
  return new Worker(
    'uptime',
    async job => {
      const { siteId, isRetry = false } = job.data as {
        siteId: string
        isRetry?: boolean
      }

      const site = await prisma.site.findUnique({ where: { id: siteId } })
      if (!site) return // deleted

      const result = await httpCheck(site.url)

      // Persist raw check
      await prisma.uptimeCheck.create({
        data: {
          site_id: siteId,
          ok: result.ok,
          status_code: result.statusCode,
          response_ms: result.responseMs,
          error: result.error,
        },
      })
      await prisma.site.update({
        where: { id: siteId },
        data: { last_check_at: new Date() },
      })

      if (result.ok) {
        await handleRecovery(site, result)
      } else {
        await handleFailure(site, result, isRetry)
      }
    },
    {
      connection: BULL_CONNECTION,
      concurrency: 20, // spec §8: handle 500 sites comfortably
    },
  )
}

// ─── Recovery path ────────────────────────────────────────────────────────────

async function handleRecovery(
  site: { id: string; status: string; org_id: string; name: string; url: string },
  _result: CheckResult,
) {
  await redis.del(RETRY_KEY(site.id))

  if (site.status === 'down') {
    await prisma.site.update({ where: { id: site.id }, data: { status: 'up' } })
    await resolveAlert(prisma, site.id, 'site.down')
    await sendPushToOrg(
      prisma,
      site.org_id,
      `${site.name} is back up`,
      `${site.url} is responding normally again.`,
      { siteId: site.id, type: 'recovery' },
    )
  } else if (site.status !== 'up') {
    await prisma.site.update({ where: { id: site.id }, data: { status: 'up' } })
  }
}

// ─── Failure path ─────────────────────────────────────────────────────────────

async function handleFailure(
  site: { id: string; status: string; org_id: string; name: string; url: string },
  result: CheckResult,
  isRetry: boolean,
) {
  const alreadyDown = site.status === 'down'

  // First failure on an otherwise-healthy site → schedule confirm retry, don't alert yet
  if (!isRetry && !alreadyDown) {
    await redis.set(RETRY_KEY(site.id), '1', 'EX', RETRY_TTL_SEC)
    await uptimeQueue.add(
      'uptime.check',
      { siteId: site.id, isRetry: true },
      { delay: 60_000, jobId: `uptime:retry:${site.id}` },
    )
    return
  }

  // Confirmed down (2nd consecutive failure) — but check flapping suppression first
  if (!alreadyDown) {
    const isFlapping = await redis.get(FLAP_KEY(site.id))
    if (!isFlapping) {
      await redis.set(FLAP_KEY(site.id), '1', 'EX', FLAP_TTL_SEC)
      await prisma.site.update({ where: { id: site.id }, data: { status: 'down' } })
      await redis.del(RETRY_KEY(site.id))

      const alertBody = result.error
        ? `${site.url} is not responding: ${result.error}`
        : `${site.url} returned HTTP ${result.statusCode}`

      await createAlert(prisma, {
        siteId: site.id,
        orgId: site.org_id,
        rule: 'site.down',
        severity: 'critical',
        title: `Site down: ${site.name}`,
        body: alertBody,
      })
    }
    // If flapping guard is set: site was marked down recently, alert already deduped — no action
  }
  // If already down: keep recording check results, alert already exists and is open
}
