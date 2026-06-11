import { Worker } from 'bullmq'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { redis } from '../lib/redis'
import { BULL_CONNECTION } from '../lib/queue'
import { createAlert } from '../lib/alerts'

const WPSCAN_BASE   = 'https://wpscan.com/api/v3'
const CACHE_TTL_SEC = 24 * 3600

interface WpScanVuln {
  title: string
  fixed_in: string | null
  cvss?: { score?: string | number }
  references?: Record<string, string[]>
}

interface WpScanResponse {
  [slug: string]: {
    slug: string
    latest_version?: string
    vulnerabilities?: WpScanVuln[]
  }
}

// Numeric semver comparison: a < b → true
export function semverLt(a: string, b: string): boolean {
  const parts = (v: string) => v.split(/[^0-9]+/).filter(Boolean).map(Number)
  const av = parts(a)
  const bv = parts(b)
  const len = Math.max(av.length, bv.length)
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0
    const bi = bv[i] ?? 0
    if (ai !== bi) return ai < bi
  }
  return false
}

// True if a vulnerability affects the installed version
function affects(installed: string, vuln: WpScanVuln): boolean {
  if (!vuln.fixed_in) return true          // unpatched
  return semverLt(installed, vuln.fixed_in) // installed < fixed_in
}

// Map to alert severity per spec §4.3
function vulnSeverity(vuln: WpScanVuln): 'critical' | 'warning' {
  const score = parseFloat(String(vuln.cvss?.score ?? '0'))
  const title = vuln.title.toLowerCase()
  if (score >= 7 || title.includes('remote code') || title.includes('auth bypass')) {
    return 'critical'
  }
  return 'warning'
}

export function startVulnWorker() {
  return new Worker(
    'vuln',
    async job => {
      const { siteId, slugs } = job.data as { siteId: string; slugs: string[] }
      const apiKey = process.env.WPSCAN_API_KEY
      if (!apiKey) {
        console.warn('[vuln.scan] WPSCAN_API_KEY not set — skipping')
        return
      }

      const site = await prisma.site.findUnique({
        where: { id: siteId },
        select: { id: true, org_id: true, name: true },
      })
      if (!site) return

      const uniqueSlugs = [...new Set(slugs)]

      for (const slug of uniqueSlugs) {
        const cacheKey = `wpscan:${slug}`
        let vulns: WpScanVuln[] = []

        // Check Redis cache first
        const cached = await redis.get(cacheKey)
        if (cached) {
          try { vulns = JSON.parse(cached) as WpScanVuln[] } catch { /* ignore */ }
        } else {
          try {
            const resp = await fetch(`${WPSCAN_BASE}/plugins/${encodeURIComponent(slug)}`, {
              headers: { Authorization: `Token token=${apiKey}` },
              signal: AbortSignal.timeout(10_000),
            })

            if (resp.status === 429) {
              console.warn('[vuln.scan] WPScan rate limit hit — stopping for today')
              return
            }
            if (!resp.ok) {
              // 404 means slug unknown to WPScan — cache empty result so we don't re-query
              await redis.set(cacheKey, '[]', 'EX', CACHE_TTL_SEC)
              continue
            }

            const body = await resp.json() as WpScanResponse
            vulns = body[slug]?.vulnerabilities ?? []
            await redis.set(cacheKey, JSON.stringify(vulns), 'EX', CACHE_TTL_SEC)
          } catch (err) {
            console.warn(`[vuln.scan] fetch error for ${slug}:`, (err as Error).message)
            continue
          }
        }

        if (vulns.length === 0) continue

        // Find the plugin record for this site
        const plugin = await prisma.plugin.findUnique({
          where: { site_id_slug: { site_id: siteId, slug } },
        })
        if (!plugin?.version) continue

        const activeVulns = vulns.filter(v => affects(plugin.version!, v))
        const isVulnerable = activeVulns.length > 0

        await prisma.plugin.update({
          where: { site_id_slug: { site_id: siteId, slug } },
          data: {
            vulnerable: isVulnerable,
            vuln_data: isVulnerable
              ? (activeVulns as unknown as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        })

        if (isVulnerable) {
          const topVuln  = activeVulns[0]
          const severity = plugin.active ? vulnSeverity(topVuln) : 'warning'
          await createAlert(prisma, {
            siteId: site.id,
            orgId: site.org_id,
            rule: `vuln:${slug}`,
            severity,
            title: `Vulnerable plugin on ${site.name}`,
            body: `${plugin.name} ${plugin.version} — ${topVuln.title}${topVuln.fixed_in ? `. Fixed in ${topVuln.fixed_in}.` : ' (no fix available)'}`,
          })
        }
      }
    },
    { connection: BULL_CONNECTION, concurrency: 3 },
  )
}
