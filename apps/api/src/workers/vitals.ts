import { Worker } from 'bullmq'
import { prisma } from '../lib/prisma'
import { BULL_CONNECTION } from '../lib/queue'

const PSI_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

interface PsiAudit { numericValue?: number }
interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } }
    audits?: {
      'largest-contentful-paint'?: PsiAudit
      'cumulative-layout-shift'?: PsiAudit
      'interaction-to-next-paint'?: PsiAudit
    }
  }
}

export function startVitalsWorker() {
  return new Worker(
    'vitals',
    async job => {
      if (job.name === 'vitals.fetch') await fetchVitals(job.data.siteId as string)
    },
    { connection: BULL_CONNECTION, concurrency: 3 },
  )
}

async function fetchVitals(siteId: string) {
  const apiKey = process.env.PSI_API_KEY
  if (!apiKey) {
    console.warn('[vitals.fetch] PSI_API_KEY not set — skipping')
    return
  }

  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { url: true },
  })
  if (!site) return

  const url = `${PSI_BASE}?url=${encodeURIComponent(site.url)}&strategy=mobile&key=${apiKey}`

  let data: PsiResponse
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!resp.ok) {
      console.warn(`[vitals.fetch] ${siteId}: PSI returned ${resp.status}`)
      return
    }
    data = await resp.json() as PsiResponse
  } catch (err) {
    console.warn(`[vitals.fetch] ${siteId}:`, (err as Error).message)
    return
  }

  const cats   = data.lighthouseResult?.categories
  const audits = data.lighthouseResult?.audits

  const performance = cats?.performance?.score != null
    ? Math.round(cats.performance.score * 100)
    : null
  const lcp_ms = audits?.['largest-contentful-paint']?.numericValue != null
    ? Math.round(audits['largest-contentful-paint']!.numericValue!)
    : null
  const cls  = audits?.['cumulative-layout-shift']?.numericValue ?? null
  const inp_ms = audits?.['interaction-to-next-paint']?.numericValue != null
    ? Math.round(audits['interaction-to-next-paint']!.numericValue!)
    : null

  await prisma.webVitals.create({
    data: { site_id: siteId, performance, lcp_ms, cls, inp_ms, strategy: 'mobile' },
  })

  console.log(`[vitals.fetch] ${siteId}: perf=${performance}, lcp=${lcp_ms}ms, cls=${cls}, inp=${inp_ms}ms`)
}
