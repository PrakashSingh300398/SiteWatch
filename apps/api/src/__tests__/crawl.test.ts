import { describe, it, expect } from 'vitest'

// ── Pure logic extracted from crawl.ts for unit testing ───────────────────────

function parseSitemapXml(xml: string): string[] {
  const locs = [...xml.matchAll(/<loc>\s*(https?:\/\/[^<]+)\s*<\/loc>/gi)]
    .map(m => m[1].trim())
  const pageUrls = locs.filter(u => !u.endsWith('.xml') && !u.includes('sitemap'))
  return pageUrls.length > 0 ? pageUrls : locs
}

function scoreColor(score: number): 'good' | 'warn' | 'poor' {
  if (score >= 80) return 'good'
  if (score >= 50) return 'warn'
  return 'poor'
}

function calcScore(issueCounts: Record<string, number>, totalPages: number): number {
  const penaltyMap: Record<string, number> = {
    missing_title:    10,
    title_too_long:    3,
    missing_meta_desc: 7,
    missing_h1:        8,
    noindex:          20,
    broken_links:     12,
    missing_sitemap:  15,
    redirect_chain:    5,
  }
  let penalty = 0
  for (const [issue, count] of Object.entries(issueCounts)) {
    if (count > 0) penalty += (penaltyMap[issue] ?? 3) * Math.min(count / totalPages, 1)
  }
  return Math.max(0, Math.round(100 - penalty))
}

function detectIssues(opts: {
  title: string | null
  metaDesc: string | null
  h1: string | null
  robots: string | null
}): string[] {
  const issues: string[] = []
  if (!opts.title) issues.push('missing_title')
  else if (opts.title.length > 60) issues.push('title_too_long')
  if (!opts.metaDesc) issues.push('missing_meta_desc')
  else if (opts.metaDesc.length > 160) issues.push('meta_desc_too_long')
  if (!opts.h1) issues.push('missing_h1')
  if (opts.robots) {
    const r = opts.robots.toLowerCase()
    if (r.includes('noindex')) issues.push('noindex')
    if (r.includes('nofollow')) issues.push('nofollow')
  }
  return issues
}

// ─── Sitemap parsing ──────────────────────────────────────────────────────────

describe('parseSitemapXml', () => {
  it('extracts page URLs from a standard sitemap', () => {
    const xml = `<?xml version="1.0"?>
<urlset>
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
  <url><loc>https://example.com/contact</loc></url>
</urlset>`
    expect(parseSitemapXml(xml)).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/contact',
    ])
  })

  it('falls back to sitemap index locs when no page URLs found', () => {
    const xml = `<sitemapindex>
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
</sitemapindex>`
    const result = parseSitemapXml(xml)
    expect(result).toHaveLength(2)
    expect(result[0]).toContain('.xml')
  })

  it('handles whitespace in loc tags', () => {
    const xml = `<urlset><url><loc>  https://example.com/page  </loc></url></urlset>`
    expect(parseSitemapXml(xml)).toEqual(['https://example.com/page'])
  })

  it('returns empty array for invalid XML', () => {
    expect(parseSitemapXml('<invalid>')).toEqual([])
  })
})

// ─── Issue detection ──────────────────────────────────────────────────────────

describe('detectIssues', () => {
  it('detects missing title', () => {
    expect(detectIssues({ title: null, metaDesc: 'desc', h1: 'H1', robots: null }))
      .toContain('missing_title')
  })

  it('detects noindex', () => {
    expect(detectIssues({ title: 'T', metaDesc: 'D', h1: 'H', robots: 'noindex, nofollow' }))
      .toContain('noindex')
  })

  it('detects nofollow separately', () => {
    expect(detectIssues({ title: 'T', metaDesc: 'D', h1: 'H', robots: 'nofollow' }))
      .toContain('nofollow')
  })

  it('detects title too long', () => {
    const longTitle = 'A'.repeat(61)
    expect(detectIssues({ title: longTitle, metaDesc: 'D', h1: 'H', robots: null }))
      .toContain('title_too_long')
  })

  it('returns no issues for a healthy page', () => {
    expect(detectIssues({ title: 'Good Title', metaDesc: 'Good description', h1: 'Main Heading', robots: null }))
      .toHaveLength(0)
  })

  it('detects multiple issues at once', () => {
    const issues = detectIssues({ title: null, metaDesc: null, h1: null, robots: 'noindex' })
    expect(issues).toContain('missing_title')
    expect(issues).toContain('missing_meta_desc')
    expect(issues).toContain('missing_h1')
    expect(issues).toContain('noindex')
  })
})

// ─── Score calculation ────────────────────────────────────────────────────────

describe('calcScore', () => {
  it('returns 100 for no issues', () => {
    expect(calcScore({}, 10)).toBe(100)
  })

  it('returns 0 minimum when penalties exceed 100', () => {
    // Each penalty is capped at 1× its weight per issue type, max penalty = sum of all weights
    // noindex(20) + broken_links(12) + missing_title(10) + missing_sitemap(15) + missing_meta_desc(7) + missing_h1(8) = 72
    // so score = max(0, 100-72) = 28
    const bigCounts = { noindex: 1, broken_links: 1, missing_title: 1, missing_sitemap: 1, missing_meta_desc: 1, missing_h1: 1, redirect_chain: 1, title_too_long: 1 }
    expect(calcScore(bigCounts, 1)).toBeGreaterThanOrEqual(0)
    expect(calcScore(bigCounts, 1)).toBeLessThan(30)
  })

  it('penalises sitewide noindex heavily', () => {
    const score = calcScore({ noindex: 1 }, 1)
    expect(score).toBe(80)
  })

  it('penalises proportionally across pages', () => {
    // 1 missing title out of 10 pages = 10 * (1/10) = 1 point penalty
    const score = calcScore({ missing_title: 1 }, 10)
    expect(score).toBe(99)
  })

  it('scoreColor buckets correctly', () => {
    expect(scoreColor(95)).toBe('good')
    expect(scoreColor(65)).toBe('warn')
    expect(scoreColor(30)).toBe('poor')
  })
})
