/**
 * Development-only seed endpoint. Disabled in production.
 * POST /v1/dev/seed  →  creates a "Demo Client Site" in the caller's org
 *                        with realistic dummy data across every feature.
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma'

export default async function devRoutes(fastify: FastifyInstance) {
  if (process.env.NODE_ENV === 'production') return // hard gate

  const { authenticate } = fastify

  fastify.post('/v1/dev/seed', { preHandler: authenticate }, async (req, reply) => {
    const orgId = req.user.orgId

    // ── Idempotent: remove existing demo site first ───────────────────────────
    await prisma.site.deleteMany({ where: { org_id: orgId, url: 'https://demo-client.example.com' } })

    // ── 1. Site ───────────────────────────────────────────────────────────────
    const now    = new Date()
    const site   = await prisma.site.create({
      data: {
        org_id:          orgId,
        url:             'https://demo-client.example.com',
        name:            'Demo Client Site',
        status:          'up',
        paired_at:       new Date(now.getTime() - 30 * 86_400_000),
        last_check_at:   new Date(now.getTime() - 4 * 60_000),
        last_health_at:  new Date(now.getTime() - 2 * 3_600_000),
        wp_version:      '6.5.3',
        php_version:     '8.2.18',
        security_score:  74,
        check_interval_sec: 300,
        score_breakdown: { uptime: 25, ssl: 20, plugins: 15, events: 14 },
        wp_users: [
          { user_login: 'admin',       display_name: 'Site Admin',    email: 'admin@demo.com',   roles: ['administrator'], registered: '2022-01-15T10:00:00Z' },
          { user_login: 'editor_jane', display_name: 'Jane Smith',    email: 'jane@demo.com',    roles: ['editor'],        registered: '2023-03-20T09:00:00Z' },
          { user_login: 'shop_mgr',    display_name: 'Shop Manager',  email: 'shop@demo.com',    roles: ['shop_manager'],  registered: '2023-06-01T08:00:00Z' },
        ],
        active_theme: { name: 'Astra', slug: 'astra', version: '4.6.4' },
        site_key_hash: 'demo-key-not-real',
      },
    })
    const sid = site.id

    // ── 2. SSL ────────────────────────────────────────────────────────────────
    await prisma.sslStatus.create({
      data: {
        site_id:         sid,
        issuer:          "Let's Encrypt",
        expires_at:      new Date(now.getTime() + 62 * 86_400_000),
        grade:           'A',
        last_checked_at: new Date(now.getTime() - 6 * 3_600_000),
      },
    })

    // ── 3. Uptime checks — 24 h at 5-min intervals ───────────────────────────
    const uptimeRows = []
    for (let i = 288; i >= 0; i--) {
      const checkedAt  = new Date(now.getTime() - i * 5 * 60_000)
      const isDown     = (i === 120 || i === 119 || i === 118) // 10 min outage 6h ago
      uptimeRows.push({
        site_id:     sid,
        checked_at:  checkedAt,
        ok:          !isDown,
        status_code: isDown ? 503 : 200,
        response_ms: isDown ? null : 180 + Math.floor(Math.random() * 120),
      })
    }
    await prisma.uptimeCheck.createMany({ data: uptimeRows })

    // ── 4. Plugins ────────────────────────────────────────────────────────────
    const plugins = [
      { slug: 'woocommerce',        name: 'WooCommerce',         version: '8.8.3',  active: true,  update_available: false, vulnerable: false },
      { slug: 'wpforms-lite',       name: 'WPForms Lite',        version: '1.8.7',  active: true,  update_available: true,  new_version: '1.8.9',  vulnerable: false },
      { slug: 'yoast-seo',          name: 'Yoast SEO',           version: '22.2',   active: true,  update_available: true,  new_version: '22.4',   vulnerable: false },
      { slug: 'elementor',          name: 'Elementor',            version: '3.21.0', active: true,  update_available: false, vulnerable: false },
      { slug: 'wordfence',          name: 'Wordfence Security',   version: '7.11.5', active: true,  update_available: false, vulnerable: false },
      { slug: 'contact-form-7',     name: 'Contact Form 7',       version: '5.9.3',  active: true,  update_available: false, vulnerable: false },
      { slug: 'wp-super-cache',     name: 'WP Super Cache',       version: '1.7.9',  active: false, update_available: false, vulnerable: false },
      { slug: 'really-simple-ssl',  name: 'Really Simple SSL',    version: '7.2.0',  active: true,  update_available: false,
        vulnerable: true,
        vuln_data: { cvss: 7.5, cve: 'CVE-2024-12345', description: 'Improper authorization allows subscriber-level users to access admin functions.' },
      },
    ]
    await prisma.plugin.createMany({
      data: plugins.map(p => ({ site_id: sid, ...p, last_seen_at: now })),
    })

    // ── 5. Events ─────────────────────────────────────────────────────────────
    const eventsData = [
      // Plugin updates
      { type: 'plugin.updated',     severity: 'info',     daysAgo: 2,  data: { name: 'WooCommerce', from: '8.8.2', to: '8.8.3', plugins: ['woocommerce/woocommerce.php'] } },
      { type: 'plugin.updated',     severity: 'info',     daysAgo: 5,  data: { name: 'Elementor',   from: '3.20.1', to: '3.21.0', plugins: ['elementor/elementor.php'] } },
      { type: 'core.updated',       severity: 'info',     daysAgo: 8,  data: { version: '6.5.3', from: '6.5.2' } },
      // Security events
      { type: 'user.login',         severity: 'info',     daysAgo: 0,  actor: { user_login: 'admin' }, data: { ip: '203.0.113.10' } },
      { type: 'user.login_failed',  severity: 'warning',  daysAgo: 1,  actor: { user_login: 'admin' }, data: { ip: '198.51.100.5', attempts: 3 } },
      { type: 'user.login_failed',  severity: 'warning',  daysAgo: 1,  actor: { user_login: 'admin' }, data: { ip: '198.51.100.5', attempts: 5 } },
      { type: 'user.login_failed',  severity: 'warning',  daysAgo: 1,  actor: { user_login: 'admin' }, data: { ip: '198.51.100.5', attempts: 7 } },
      { type: 'settings.changed',   severity: 'warning',  daysAgo: 3,  actor: { user_login: 'admin' }, data: { option: 'siteurl', new_value: 'https://demo-client.example.com' } },
      { type: 'plugin.installed',   severity: 'info',     daysAgo: 6,  data: { name: 'Wordfence Security', plugins: ['wordfence/wordfence.php'] } },
      { type: 'plugin.deactivated', severity: 'info',     daysAgo: 7,  data: { name: 'WP Super Cache',     plugins: ['wp-super-cache/wp-cache.php'] } },
      { type: 'theme.switched',     severity: 'warning',  daysAgo: 9,  actor: { user_login: 'admin' }, data: { new_theme: 'Astra', old_theme: 'Hello Elementor' } },
      // Integrity events
      { type: 'integrity.php_in_uploads', severity: 'critical', daysAgo: 4, data: { files: ['/wp-content/uploads/2024/05/shell.php'], count: 1 } },
      // Site outage (matches the 3 down checks)
      { type: 'site.down',          severity: 'critical', daysAgo: 0,  data: { status_code: 503, duration_min: 10 } },
      { type: 'site.recovered',     severity: 'info',     daysAgo: 0,  data: { downtime_min: 10 } },
      // SEO change
      { type: 'seo.title_changed',  severity: 'info',     daysAgo: 12, data: { url: 'https://demo-client.example.com/', from: 'Old Title | Demo Site', to: 'Demo Client Site — Premium Services' } },
    ] as Array<{ type: string; severity: string; daysAgo: number; data?: Record<string, unknown>; actor?: Record<string, unknown> }>

    for (const e of eventsData) {
      const h = e.daysAgo === 0 ? Math.random() * 6 : 0
      await prisma.event.create({
        data: {
          site_id:     sid,
          type:        e.type,
          severity:    e.severity as never,
          occurred_at: new Date(now.getTime() - e.daysAgo * 86_400_000 - h * 3_600_000),
          actor:       (e.actor ?? null) as never,
          data:        (e.data   ?? null) as never,
        },
      })
    }

    // ── 6. Alerts ─────────────────────────────────────────────────────────────
    const phpAlert = await prisma.alert.create({
      data: {
        site_id:  sid, org_id: orgId,
        rule:     'integrity.php_in_uploads',
        severity: 'critical',
        title:    'PHP file found in uploads directory',
        body:     '1 PHP file detected in /wp-content/uploads/. This may indicate a compromised site. Investigate and remove immediately.',
        created_at: new Date(now.getTime() - 4 * 86_400_000),
      },
    })
    await prisma.alert.create({
      data: {
        site_id:  sid, org_id: orgId,
        rule:     'plugin.vulnerable',
        severity: 'warning',
        title:    'Vulnerable plugin: Really Simple SSL',
        body:     'Really Simple SSL v7.2.0 has a known vulnerability (CVE-2024-12345, CVSS 7.5). Update to the latest version immediately.',
        created_at: new Date(now.getTime() - 6 * 86_400_000),
      },
    })
    // Resolved alert
    await prisma.alert.create({
      data: {
        site_id:    sid, org_id: orgId,
        rule:       'site.down',
        severity:   'critical',
        title:      'Site is DOWN',
        body:       'demo-client.example.com returned 503 for 10 minutes.',
        created_at: new Date(now.getTime() - 6 * 3_600_000),
        resolved_at:new Date(now.getTime() - 5.8 * 3_600_000),
      },
    })

    // AI brief for the PHP alert
    await prisma.aiInsight.create({
      data: {
        site_id:           sid,
        alert_id:          phpAlert.id,
        kind:              'brief',
        model:             'claude-haiku-4-5-20251001',
        prompt_tokens:     312,
        completion_tokens: 198,
        content: `What happened:\nA PHP file named shell.php was detected in your WordPress uploads directory (/wp-content/uploads/2024/05/). This is a common indicator of a web shell — a malicious script attackers use to execute commands on your server. This likely resulted from an exploited vulnerability in a theme, plugin, or via brute-force login. The recent failed login attempts on your site are also concerning in this context.\n\nHow to fix:\n1. Immediately delete the file: /wp-content/uploads/2024/05/shell.php via FTP or cPanel File Manager\n2. Change all admin passwords and revoke any suspicious user sessions in Users → All Users\n3. Update Really Simple SSL (currently vulnerable, CVE-2024-12345) and all other plugins to their latest versions\n4. Install and run a malware scanner such as Wordfence (already installed — run a full scan now)\n5. Consider enabling two-factor authentication for all administrator accounts`,
      },
    })

    // ── 7. Form monitors ──────────────────────────────────────────────────────
    await prisma.formMonitor.createMany({
      data: [
        { site_id: sid, form_plugin: 'wpforms', form_id: '1', form_name: 'Contact Us',     baseline_daily: 4.2, count_24h: 3, count_7d: 28, last_entry_at: new Date(now.getTime() - 5 * 3_600_000),  alert_state: null },
        { site_id: sid, form_plugin: 'wpforms', form_id: '2', form_name: 'Quote Request',  baseline_daily: 1.8, count_24h: 0, count_7d: 2,  last_entry_at: new Date(now.getTime() - 4 * 86_400_000), alert_state: 'stopped' },
        { site_id: sid, form_plugin: 'cf7',     form_id: '3', form_name: 'Newsletter Opt-In', baseline_daily: 2.1, count_24h: 2, count_7d: 15, last_entry_at: new Date(now.getTime() - 8 * 3_600_000),  alert_state: null },
      ],
    })

    // ── 8. Web vitals ─────────────────────────────────────────────────────────
    await prisma.webVitals.create({
      data: {
        site_id:     sid,
        measured_at: new Date(now.getTime() - 2 * 86_400_000),
        performance: 68,
        lcp_ms:      3200,
        cls:         0.14,
        inp_ms:      210,
        strategy:    'mobile',
      },
    })

    // ── 9. GSC / SEO data ─────────────────────────────────────────────────────
    // 28 days of daily traffic (realistic WoW drop last 7d)
    const dailyRows = []
    for (let i = 28; i >= 1; i--) {
      const date        = new Date(now); date.setUTCHours(0,0,0,0); date.setDate(date.getDate() - i)
      const isLast7     = i <= 7
      const baseClicks  = isLast7 ? 75 : 108  // ~30% drop last week
      const clicks      = baseClicks + Math.floor(Math.random() * 20) - 10
      const impressions = clicks * 18 + Math.floor(Math.random() * 200)
      dailyRows.push({ site_id: sid, date, clicks, impressions, ctr: clicks / impressions, avg_position: 8.2 + Math.random() * 3 })
    }
    await prisma.seoDaily.createMany({ data: dailyRows })

    // Top queries
    const queryDate = new Date(now); queryDate.setUTCHours(0,0,0,0); queryDate.setDate(queryDate.getDate() - 1)
    await prisma.seoQuery.createMany({
      data: [
        { site_id: sid, date: queryDate, query: 'wordpress website design calgary',  clicks: 42, impressions: 320,  position: 4.1,  is_priority: true },
        { site_id: sid, date: queryDate, query: 'web design company alberta',         clicks: 31, impressions: 580,  position: 6.8,  is_priority: true },
        { site_id: sid, date: queryDate, query: 'wordpress maintenance service',      clicks: 28, impressions: 210,  position: 3.2,  is_priority: false },
        { site_id: sid, date: queryDate, query: 'woocommerce store setup',            clicks: 19, impressions: 445,  position: 9.5,  is_priority: false },
        { site_id: sid, date: queryDate, query: 'elementor page builder tutorial',    clicks: 14, impressions: 890,  position: 12.3, is_priority: false },
        { site_id: sid, date: queryDate, query: 'wordpress seo plugin',               clicks: 11, impressions: 1200, position: 15.7, is_priority: false },
        { site_id: sid, date: queryDate, query: 'contact form 7 vs wpforms',          clicks: 8,  impressions: 340,  position: 8.9,  is_priority: false },
        { site_id: sid, date: queryDate, query: 'best wordpress hosting canada',      clicks: 6,  impressions: 760,  position: 18.4, is_priority: false },
      ],
    })

    // Index status
    const indexDate = new Date(now); indexDate.setUTCHours(0,0,0,0)
    await prisma.seoIndexStatus.create({
      data: { site_id: sid, date: indexDate, indexed_count: 87, excluded_noindex: 12, crawled_not_indexed: 5, server_errors: 0 },
    })

    // ── 10. Technical SEO crawl ───────────────────────────────────────────────
    const crawledAt = new Date(now.getTime() - 86_400_000)
    const crawlPages = [
      { url: 'https://demo-client.example.com/',              title: 'Demo Client Site — Premium Services', meta_desc: 'Professional WordPress design and maintenance in Calgary.', canonical: 'https://demo-client.example.com/', robots: null, h1: 'Premium WordPress Services', issues: [] },
      { url: 'https://demo-client.example.com/about',         title: 'About Us | Demo Client Site',         meta_desc: 'Learn about our team.',                                   canonical: null,                                robots: null, h1: 'About Our Team',             issues: ['missing_alt:3'] },
      { url: 'https://demo-client.example.com/services',      title: null,                                  meta_desc: 'WordPress design, maintenance, and SEO services.',        canonical: null,                                robots: null, h1: 'Our Services',               issues: ['missing_title'] },
      { url: 'https://demo-client.example.com/contact',       title: 'Contact Us | Demo Client Site',       meta_desc: null,                                                     canonical: null,                                robots: null, h1: 'Get In Touch',               issues: ['missing_meta_desc'] },
      { url: 'https://demo-client.example.com/blog',          title: 'Blog | Demo Client Site',             meta_desc: 'Tips, guides, and news from our team.',                  canonical: null,                                robots: null, h1: null,                          issues: ['missing_h1'] },
      { url: 'https://demo-client.example.com/portfolio',     title: 'A'.repeat(65),                        meta_desc: 'View our portfolio of client websites.',                 canonical: null,                                robots: null, h1: 'Our Work',                   issues: ['title_too_long'] },
      { url: 'https://demo-client.example.com/privacy-policy',title: 'Privacy Policy | Demo Client Site',   meta_desc: 'Our privacy policy.',                                    canonical: null,                                robots: 'noindex, nofollow',                    h1: 'Privacy Policy',             issues: ['noindex', 'nofollow'] },
      { url: 'https://demo-client.example.com/broken-page',   title: null,                                  meta_desc: null,                                                     canonical: null,                                robots: null, h1: null,                          issues: ['broken_link', 'http_404'] },
      { url: 'https://demo-client.example.com/shop',          title: 'Shop | Demo Client Site',             meta_desc: 'Browse our products.',                                   canonical: 'https://demo-client.example.com/shop/', robots: null, h1: 'Our Products',               issues: [] },
      { url: 'https://demo-client.example.com/faqs',          title: 'FAQs | Demo Client Site',             meta_desc: 'Frequently asked questions.',                            canonical: null,                                robots: null, h1: 'Frequently Asked Questions', issues: ['missing_alt:5'] },
    ]
    for (const p of crawlPages) {
      await prisma.crawlPage.create({ data: { site_id: sid, crawled_at: crawledAt, ...p, issues: p.issues as never } })
    }

    await prisma.seoAuditSummary.create({
      data: {
        site_id:     sid,
        crawled_at:  crawledAt,
        score:       72,
        issue_counts: { missing_title: 1, missing_meta_desc: 1, missing_h1: 1, title_too_long: 1, noindex: 1, broken_links: 1, missing_alt: 2, missing_sitemap: 0 },
      },
    })

    // GSC traffic drop alert (WoW ~30% drop)
    await prisma.alert.create({
      data: {
        site_id: sid, org_id: orgId,
        rule:    'gsc.traffic_drop',
        severity:'warning',
        title:   'Search traffic down 31% this week',
        body:    'Clicks dropped from 756 last week to 525 this week (−31%). Check for ranking changes or indexing issues.',
        created_at: new Date(now.getTime() - 86_400_000),
      },
    })

    // ── 11. AI crawler stats ──────────────────────────────────────────────────
    const bots = [
      { bot: 'GPTBot',        hitsPerDay: 18 },
      { bot: 'ClaudeBot',     hitsPerDay: 12 },
      { bot: 'PerplexityBot', hitsPerDay: 6  },
      { bot: 'Google-Extended',hitsPerDay: 9 },
    ]
    const aiStatRows = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now); date.setUTCHours(0,0,0,0); date.setDate(date.getDate() - i)
      for (const { bot, hitsPerDay } of bots) {
        const hits = hitsPerDay + Math.floor(Math.random() * 8) - 4
        if (hits > 0) {
          aiStatRows.push({
            site_id: sid, date, bot,
            hits,
            sample_paths: ['/blog', '/services', '/about'],
          })
        }
      }
    }
    await prisma.aiCrawlerStat.createMany({ data: aiStatRows as never })

    // AI referral sessions
    const aiSources = [
      { source: 'chatgpt.com',       sessionsPerDay: 4 },
      { source: 'perplexity.ai',     sessionsPerDay: 2 },
      { source: 'claude.ai',         sessionsPerDay: 1 },
    ]
    const aiReferralRows = []
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now); date.setUTCHours(0,0,0,0); date.setDate(date.getDate() - i)
      for (const { source, sessionsPerDay } of aiSources) {
        const sessions = sessionsPerDay + Math.floor(Math.random() * 3)
        aiReferralRows.push({ site_id: sid, date, source, sessions })
      }
    }
    await prisma.aiReferralDaily.createMany({ data: aiReferralRows })

    return reply.send({
      ok: true,
      siteId: sid,
      siteName: 'Demo Client Site',
      message: 'Demo data created. Reload the app and look for "Demo Client Site" in your sites list.',
      summary: {
        uptimeChecks: uptimeRows.length,
        events: eventsData.length,
        alerts: 4,
        plugins: plugins.length,
        forms: 3,
        crawlPages: crawlPages.length,
        aiCrawlerStats: aiStatRows.length,
      },
    })
  })

  // DELETE /v1/dev/seed — remove demo site
  fastify.delete('/v1/dev/seed', { preHandler: authenticate }, async (req, reply) => {
    const deleted = await prisma.site.deleteMany({
      where: { org_id: req.user.orgId, url: 'https://demo-client.example.com' },
    })
    return reply.send({ ok: true, deleted: deleted.count })
  })
}
