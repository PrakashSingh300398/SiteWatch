# SiteWatch — WordPress Monitoring & Security Platform
## Technical Specification v2.0 (adds SEO/Marketing module §9 and AI module §10)

**Owner:** Prakash Singh, Code to Click (Calgary, AB)
**Initial deployment:** ~31 client WordPress sites hosted on Cloudways
**Long-term goal:** Multi-tenant SaaS sold to other agencies ($19–49/mo tiers)

---

## 1. Product summary

SiteWatch is a monitoring and security-audit platform for agencies managing many WordPress sites. It consists of three components:

1. **Companion WordPress plugin** (`sitewatch-agent`) — installed on each monitored site; captures security/activity events and reports site health via a secured REST endpoint.
2. **Backend API + worker** — central server that performs uptime/SSL checks, ingests events from agents, runs vulnerability scans, evaluates alert rules, and sends push notifications.
3. **Mobile app** (React Native + Expo, iOS + Android) — dashboard, per-site detail, security timeline, alerts feed, settings.

A web dashboard is planned for Phase 3 (reuse the same API).

**v1 is strictly read-only/monitoring.** No remote actions (no remote user suspension, no remote plugin updates). Remote actions are Phase 3+ and require additional security design.

---

## 2. Tech stack

| Component | Technology | Notes |
|---|---|---|
| Mobile app | React Native + Expo (managed workflow), TypeScript | Expo Push Notifications, EAS Build for store builds |
| Backend API | Node.js 20+, TypeScript, Fastify (or Express) | REST API, JWT auth |
| Worker/cron | Node.js worker process + BullMQ (Redis) for job queues | Uptime pings, SSL checks, vuln scans, digest emails |
| Database | PostgreSQL 15+ | Prisma ORM |
| Cache/queue | Redis | BullMQ queues, rate limiting, IP geo cache |
| WP plugin | PHP 7.4+ compatible (target 8.x), no Composer deps in shipped build | Single plugin folder, WordPress.org coding standards |
| Push | Expo Push Notification service | Free tier sufficient initially |
| Hosting | Single VPS/Cloudways server (2GB+) for API + worker + Postgres + Redis | Dockerized via docker-compose |
| Email | Resend or SMTP (configurable) | Daily digests, weekly reports |
| External APIs | WPScan API (vulnerability DB), Google PageSpeed Insights API (CWV), ip-api.com or MaxMind GeoLite2 (IP geolocation), api.wordpress.org checksums | All free tiers initially |

Monorepo layout:

```
sitewatch/
├── apps/
│   ├── api/          # Fastify API + worker
│   └── mobile/       # Expo app
├── packages/
│   └── shared/       # TypeScript types shared between api and mobile
├── wp-plugin/
│   └── sitewatch-agent/   # PHP plugin (zip-distributable)
├── docker-compose.yml
└── README.md
```

---

## 3. Component 1 — WordPress companion plugin (`sitewatch-agent`)

### 3.1 Setup & authentication
- On activation, plugin generates a random 64-char **site key** (stored in `wp_options`, never displayed in full after creation).
- Admin pastes a **pairing code** from the mobile app/backend; plugin calls `POST {backend}/v1/sites/pair` with pairing code + site URL + site key. Backend stores the site key hash; all future agent→backend requests are signed with HMAC-SHA256 using the site key (header: `X-SiteWatch-Signature`, payload includes timestamp; reject if clock skew > 5 min to prevent replay).
- Plugin exposes ONE inbound REST route: `GET /wp-json/sitewatch/v1/health` — requires valid HMAC signature from backend. Returns health snapshot (see 3.3). Everything else is **outbound push** from plugin to backend (firewall-friendly).

### 3.2 Event capture (outbound, real-time)
Hook into WordPress core actions and POST events to `POST {backend}/v1/events` (batched: buffer in a custom DB table, flush every 60s via WP-Cron, immediate flush for critical events).

Events to capture, with WP hooks:

| Event | Hook(s) | Severity default |
|---|---|---|
| User created | `user_register` | **critical** if role=administrator, else info |
| User role changed | `set_user_role` | **critical** if promoted to administrator/editor, else warning |
| User deleted | `delete_user` | warning |
| Admin password reset | `after_password_reset`, `profile_update` (password change detection) | warning |
| Login success | `wp_login` | info; **critical** if admin from never-seen IP/country (decided server-side) |
| Login failed | `wp_login_failed` | info (server-side spike detection escalates) |
| Plugin installed | `upgrader_process_complete` (type=plugin, action=install) | warning |
| Plugin activated/deactivated | `activated_plugin`, `deactivated_plugin` | warning |
| Plugin/theme/core updated | `upgrader_process_complete` | info (correlation with downtime handled server-side) |
| Plugin deleted | `deleted_plugin` | warning |
| Theme switched | `switch_theme` | warning |
| Critical option changed | `updated_option` for allowlist: `siteurl`, `home`, `admin_email`, `users_can_register`, `default_role`, `permalink_structure`, `blog_public`, `WP_DEBUG` state via constant check | warning |
| Post/page published or edited | `transition_post_status` | info (digest only; capture author, post ID, title) |

Event payload (JSON):
```json
{
  "site_id": "uuid",
  "events": [{
    "type": "user.created",
    "severity_hint": "critical",
    "occurred_at": "2026-06-09T03:14:22Z",
    "actor": {"user_login": "wp_support1", "user_id": 12, "ip": "185.220.1.2"},
    "data": {"new_user_login": "wp_support1", "role": "administrator"},
    "request": {"ip": "185.220.1.2", "user_agent": "..."}
  }]
}
```

### 3.3 Health snapshot (pulled by backend every 6h, or on demand)
`GET /wp-json/sitewatch/v1/health` returns:
- WP core version + available core update
- PHP version, MySQL version, memory limit
- All plugins: slug, name, version, active?, update available + new version
- All themes: same
- All users with role administrator (login + last-seen, no emails/hashes)
- Security checklist booleans: `DISALLOW_FILE_EDIT` set, `WP_DEBUG` on/off, default `admin` username exists, XML-RPC enabled, user registration open
- Gravity Forms / WPForms / CF7 detection + per-form submission counts for last 24h/7d (Gravity Forms: query `gf_entry` table; CF7 via Flamingo if present; WPForms via entries table — degrade gracefully if absent)

### 3.4 Daily integrity scan (WP-Cron, off-peak)
- **Core file checksums:** compare against `https://api.wordpress.org/core/checksums/1.0/`. Report modified/extra core files.
- **Uploads PHP scan:** find `*.php` files under `wp-content/uploads/` — any hit = critical event.
- Cap scan time (e.g., 30s budget, resume next run) to avoid hurting shared hosting performance.

### 3.5 Plugin non-functional requirements
- Zero impact on page load: all hooks lightweight; event buffering in custom table `wp_sitewatch_queue`; outbound HTTP only via WP-Cron or `shutdown` hook with 2s timeout, non-blocking where possible.
- No external dependencies, no jQuery, no admin UI beyond a single settings page (pairing code input, connection status, last sync time, disconnect button).
- Uninstall hook removes all tables and options.
- All output escaped, all input sanitized, nonces on settings form — follow WordPress Plugin Handbook security guidelines.

---

## 4. Component 2 — Backend API + worker

### 4.1 Data model (Postgres, via Prisma)

```
Organization (id, name, plan, created_at)
User (id, org_id, email, password_hash, role[owner|member], expo_push_tokens jsonb)
Site (id, org_id, url, name, site_key_hash, status[up|down|unknown], paired_at,
      last_check_at, last_health_at, wp_version, php_version, security_score int,
      check_interval_sec default 300, settings jsonb)
UptimeCheck (id, site_id, checked_at, ok bool, status_code, response_ms, error text)
  -- partition or prune: keep raw 30 days, hourly rollups 1 year (UptimeRollup table)
SslStatus (site_id PK, issuer, expires_at, grade, last_checked_at)
Event (id, site_id, type, severity[info|warning|critical], occurred_at, actor jsonb,
       data jsonb, ip, geo jsonb, correlated_event_id nullable)
Plugin (id, site_id, slug, name, version, active bool, update_available bool,
        new_version, vulnerable bool, vuln_data jsonb, last_seen_at)
FormMonitor (id, site_id, form_plugin, form_id, form_name, baseline_daily numeric,
             count_24h, count_7d, last_entry_at, alert_state)
Alert (id, site_id, org_id, rule, severity, title, body, created_at,
       acknowledged_at, resolved_at, event_id nullable)
KnownIp (id, site_id, user_login, ip, country, first_seen, last_seen)
WebVitals (id, site_id, measured_at, performance, lcp_ms, cls, inp_ms, strategy[mobile|desktop])
```

### 4.2 API endpoints (REST, JSON, JWT auth for app; HMAC for agents)

Auth: `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`
Sites: `GET /v1/sites` (list + status summary), `POST /v1/sites` (creates pairing code), `GET /v1/sites/:id`, `PATCH /v1/sites/:id` (settings), `DELETE /v1/sites/:id`, `GET /v1/sites/:id/uptime?range=24h|7d|30d`, `GET /v1/sites/:id/events?severity=&type=&cursor=`, `GET /v1/sites/:id/plugins`, `GET /v1/sites/:id/security` (score breakdown + checklist), `GET /v1/sites/:id/forms`, `GET /v1/sites/:id/vitals`
Agent: `POST /v1/sites/pair`, `POST /v1/events` (HMAC), `POST /v1/health` (HMAC, agent may also push snapshot)
Alerts: `GET /v1/alerts?status=open`, `POST /v1/alerts/:id/ack`, `POST /v1/alerts/:id/resolve`
Devices: `POST /v1/devices` (register Expo push token), `DELETE /v1/devices/:token`
Dashboard: `GET /v1/dashboard` (aggregate: sites up/down, open alerts by severity, ssl expiring count, updates pending count)
Reports (Phase 2): `GET /v1/sites/:id/report?month=2026-05` → PDF

### 4.3 Worker jobs (BullMQ)

| Job | Schedule | Logic |
|---|---|---|
| `uptime.check` | per-site interval (default 300s, min 60s) | HTTPS GET site URL, 10s timeout, follow ≤3 redirects. Failure = non-2xx/3xx or timeout. **Confirm-before-alert:** on first failure, recheck after 60s; 2 consecutive failures → mark down + critical alert. On recovery → resolve alert + recovery push. Record response_ms. |
| `ssl.check` | daily per site | TLS handshake, read cert expiry/issuer. Alerts at 14/7/3/1 days and on expiry. |
| `health.pull` | every 6h per site | Call agent `/health`, upsert plugins/users/forms/checklist, recompute security score. |
| `vuln.scan` | daily, batched | Collect distinct plugin slug+version across all sites → query WPScan API → mark `vulnerable`, create warning alerts (critical if CVSS ≥ 7 or auth-bypass/RCE class). Cache results 24h. |
| `events.process` | on ingest | Enrich with geo (cached), apply rules engine (4.4), persist, fan out alerts. |
| `downtime.correlate` | on site-down alert | Look back 10 min for plugin/theme/core update or activation events on that site → set `correlated_event_id`, include "Likely cause: X updated 90s before outage" in alert body. |
| `forms.watch` | hourly | Compare 24h counts vs baseline (trailing 14-day daily average, min baseline 1/day). If baseline ≥ 1/day and 0 entries for 3 days → warning alert "form submissions stopped". |
| `vitals.fetch` | weekly per site | PageSpeed Insights API (mobile strategy), store scores. |
| `digest.daily` | 8:00 org-local time | Email + push summary of info-level events and open warnings. |
| `prune.data` | nightly | Enforce retention (raw uptime 30d, events 180d on starter plan, etc.). |

### 4.4 Alert rules engine

Severity tiers drive notification behavior (per-org configurable quiet hours; critical always breaks through):

**Critical (instant push, bypass quiet hours):**
- Site down (2 consecutive failed checks)
- SSL expired or expires < 3 days
- New administrator user created
- User promoted to administrator
- Admin login from never-seen country for that user (check `KnownIp`; seed known IPs during a 7-day learning window after pairing)
- Modified WP core file or PHP file found in uploads
- Vulnerability with CVSS ≥ 7 on an **active** plugin

**Warning (push during work hours, else queued to morning):**
- Brute force: > 100 failed logins in 15 min (sliding window, Redis counter)
- Plugin deactivated/deleted, theme switched
- Critical option changed (siteurl, admin_email, users_can_register…)
- SSL expires < 14 days
- Vulnerability CVSS < 7, or vulnerable but inactive plugin
- Form submissions stopped

**Info (daily digest only):** logins from known IPs, content edits, routine updates, new known-IP learned.

Deduplication: identical rule+site alert not re-fired while an open alert exists; downtime flapping suppressed (max 1 down alert per 30 min per site).

### 4.5 Security score (0–100, recomputed on each health pull)
Start at 100, subtract: active vulnerable plugin −25 (cap −40), inactive vulnerable −10, PHP < 8.0 −10, WP core update available −10 (security release −20), `admin` username exists −10, user registration open with default role ≥ author −15, file editing enabled (`DISALLOW_FILE_EDIT` not set) −5, WP_DEBUG on in production −5, XML-RPC enabled −5, SSL expires < 14d −10, > 5 administrator accounts −5. Floor 0. Store breakdown JSON for the app to render the checklist.

### 4.6 Backend security requirements
- All agent traffic HMAC-signed + timestamped (replay window 5 min); site keys stored hashed (SHA-256) — raw key lives only on the WP site.
- JWT access tokens 15 min + refresh tokens (rotating, httpOnly for future web); bcrypt/argon2 password hashing; rate limiting on auth endpoints (Redis).
- Multi-tenant isolation: every query scoped by org_id; Prisma middleware to enforce.
- Input validation with zod on every endpoint; helmet headers; CORS locked to app origins.
- No remote-action endpoints in v1 (attack-surface decision — the backend must never be able to modify client sites).
- Secrets via environment variables; audit log table for auth events on the platform itself.

---

## 5. Component 3 — Mobile app (Expo, TypeScript)

### 5.1 Screens

1. **Auth:** login, register (org name + email + password), forgot password.
2. **Dashboard (Home):**
   - Metric cards: sites up X/Y, critical alerts, SSL expiring soon, updates pending.
   - "Needs attention" list: open critical + warning alerts (tappable → alert detail/site).
   - All-sites list: status dot (green/amber/red), domain, uptime %, CWV score, pending updates, last response time. Pull-to-refresh. Search/filter.
3. **Site detail** (tabs or segmented control):
   - *Overview:* status, uptime chart (24h/7d/30d), response-time sparkline, SSL card (issuer, expiry), WP/PHP versions, pending updates list.
   - *Security:* security score with checklist breakdown, vulnerable plugins, failed-login count, activity timeline (chronological events with severity dots; downtime events show "Likely cause" correlation chip when present). Infinite scroll with severity/type filters.
   - *Forms:* per-form entry counts (24h/7d), baseline, last entry time, alert state.
   - *Vitals:* CWV trend chart (performance score, LCP, CLS, INP over time).
   - *SEO (Phase 2, see §9):* GSC clicks/impressions/position trends, indexing status, technical audit findings, GBP reviews.
   - *AI (Phase 2/3, see §10):* AI crawler stats, AI referral traffic, AI readiness score, answer-presence checks, AI incident briefs, ask-your-sites chat.
4. **Alerts feed:** all alerts across sites, filter by severity/status, swipe to acknowledge, tap → detail with linked event + site shortcut.
5. **Settings:** notification preferences (quiet hours, severity thresholds per type), site management (add site → shows pairing code + plugin download link/instructions), team members (Phase 2), account, subscription (Phase 3).

### 5.2 App technical requirements
- Expo SDK (latest stable), TypeScript, Expo Router for navigation.
- State/data: TanStack Query (react-query) for API calls with cache + pull-to-refresh; secure token storage via `expo-secure-store`.
- Push: `expo-notifications`; register token with `POST /v1/devices`; deep-link from notification → relevant site/alert screen.
- Charts: `react-native-svg` + victory-native (or react-native-gifted-charts) for uptime/vitals charts.
- Dark mode support; works offline-tolerant (show cached data + "last updated" stamp).
- Status colors: green=up, amber=warning, red=down/critical — consistent everywhere.

---

## 6. Build plan (suggested order for Claude Code)

**Phase 1 — MVP (target: usable on my own 31 sites):**
1. Monorepo scaffold + docker-compose (Postgres, Redis, API, worker).
2. Backend: auth, sites CRUD + pairing, uptime + SSL jobs, alert engine (down/SSL rules only), Expo push, dashboard endpoint.
3. WP plugin: pairing, settings page, health endpoint, event capture for users/logins/plugins, event queue + flush.
4. Backend: event ingest + rules (new admin, role change, brute force, new-country login), health pull, security score, vuln scan via WPScan.
5. Mobile app: auth, dashboard, site list, site overview + security timeline, alerts feed, push + deep links, add-site flow.
6. Downtime↔update correlation job.

**Phase 2:** form monitoring, CWV, daily digests, integrity scans (core checksums + uploads PHP scan), white-label PDF reports, team members, **SEO module core (§9.1–9.3: GSC integration, crawler, SEO alert rules)**, **AI quick wins (§10.1–10.2: AI crawler tracking, AI incident briefs)**.

**Phase 3 (not in this build):** web dashboard, Stripe billing/multi-tenant plans, remote actions with confirmation tokens, **GBP integration (§9.4)**, **answer-presence checks + ask-your-sites chat (§10.3–10.4)**, keyword rank tracking via DataForSEO.

**Schema note for Phase 1:** even though SEO/AI features ship later, include the `GscConnection`, `AiCrawlerStat`, and `AiInsight` tables in the initial Prisma schema (defined in §9/§10) to avoid migrations breaking the agent payload format later. The agent plugin should log AI crawler user-agents from day one (§10.1) — it is trivial and the historical data becomes valuable.

**Definition of done for Phase 1:** all 31 Code to Click sites paired; a site outage produces a push notification within 2 minutes including likely-cause correlation when applicable; creating a test admin user on a site produces a critical push within 90 seconds; dashboard loads in < 1.5s with 31 sites.

---

## 7. Environment variables (backend)

```
DATABASE_URL=postgres://...
REDIS_URL=redis://...
JWT_SECRET=...
JWT_REFRESH_SECRET=...
WPSCAN_API_KEY=...
PSI_API_KEY=...            # Google PageSpeed Insights
EXPO_ACCESS_TOKEN=...      # optional, for push receipts
EMAIL_PROVIDER=resend|smtp
RESEND_API_KEY=...
APP_BASE_URL=https://api.sitewatch.example
GEOIP_PROVIDER=ipapi|maxmind
GOOGLE_OAUTH_CLIENT_ID=...     # GSC + GA4 + GBP (Phase 2/3)
GOOGLE_OAUTH_CLIENT_SECRET=...
ANTHROPIC_API_KEY=...          # AI features (Phase 2) — backend only, never shipped to app
AI_MODEL_FAST=claude-haiku-4-5-20251001   # incident briefs, review drafts
AI_MODEL_SMART=claude-sonnet-4-6          # report narratives, ask-your-sites
DATAFORSEO_LOGIN=...           # optional, Phase 3 rank tracking
DATAFORSEO_PASSWORD=...
```

## 8. Testing requirements
- Backend: unit tests for rules engine (every rule), HMAC verification, security-score calculator; integration test for pairing flow and event ingest (vitest + supertest).
- WP plugin: test on WP 6.x with PHP 8.1/8.2; verify zero front-end performance impact (no hooks on `wp_head`/front-end render path); test uninstall cleanup.
- Load sanity: uptime worker must comfortably handle 500 sites at 5-min intervals on a 2GB server (stagger checks, concurrency limit ~20).
- Mobile: smoke tests for auth + dashboard render; manual push-notification test matrix (foreground/background/killed, iOS + Android).

---

## 9. SEO & Marketing module (Phase 2 core, Phase 3 extras)

### 9.1 Google Search Console integration
- OAuth 2.0 flow (mobile app opens browser → backend callback) requesting `webmasters.readonly` scope; store refresh token per site in `GscConnection`.
- Daily worker job `gsc.pull`: Search Analytics API → clicks, impressions, CTR, avg position (site-level daily + top 25 queries + top 25 pages); Index Coverage via URL Inspection sampling or sitemaps/index status report.
- Tables:
```
GscConnection (id, site_id, google_email, refresh_token_encrypted, property_url, connected_at, status)
SeoDaily (id, site_id, date, clicks, impressions, ctr, avg_position)
SeoQuery (id, site_id, date, query, clicks, impressions, position, is_priority bool)
SeoIndexStatus (id, site_id, date, indexed_count, excluded_noindex, crawled_not_indexed, server_errors)
```
- Refresh tokens encrypted at rest (AES-256-GCM, key from env).

### 9.2 Weekly technical SEO crawler (own worker, no API cost)
- Job `seo.crawl`: fetch sitemap.xml, crawl ≤100 pages/site weekly, 1 req/sec politeness, identify as `SiteWatchBot`.
- Per page capture: title, meta description, canonical, robots meta, H1s, internal link targets (+status of each), image alt coverage, JSON-LD types present.
- Findings: missing/duplicate titles & metas, missing H1, broken internal links (404/redirect chains ≥2), accidental noindex/nofollow, robots.txt blocking site or AI crawlers, invalid/missing sitemap, broken structured data.
- **Change detection:** diff title/meta/canonical/robots against previous crawl → `seo.change` events into the existing Event table (type `seo.title_changed` etc.) so they appear on the activity timeline.
- Tables: `CrawlPage (id, site_id, url, crawled_at, title, meta_desc, canonical, robots, h1, issues jsonb)`, `SeoAuditSummary (site_id, crawled_at, score, issue_counts jsonb)`.

### 9.3 SEO alert rules (extend §4.4 rules engine)
- **Critical:** sitewide noindex detected on crawl; indexed-page count drops >10% week-over-week.
- **Warning:** clicks down >30% WoW (min 50 clicks/wk baseline); priority query falls out of top 10; >5 new broken internal links; GSC connection expired/revoked.
- **Info (digest):** title/meta changes, new top-10 query gained.
- Correlate index drops and traffic drops against plugin-update events within ±7 days → "Likely cause" chip (reuse §4.3 correlation pattern).

### 9.4 Google Business Profile (Phase 3)
- GBP API OAuth (same Google connection), poll reviews + rating daily.
- Alerts: new review ≤3 stars (warning), rating drop ≥0.1 (info), listing data changed by Google suggestion (warning).
- Table: `GbpReview (id, site_id, review_id, rating, text, author, created_at, replied bool)`.

---

## 10. AI module

### 10.1 AI crawler tracking (Phase 2 — agent-side, zero API cost)
- Agent plugin logs requests whose user-agent matches a maintained list: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Google-Extended, Bytespider, Amazonbot, etc. (list shipped in plugin, updatable from backend).
- Count-only aggregation (bot, date, hits, distinct paths sampled) — no full logs, privacy-light, batched daily to backend.
- GA4 integration (same Google OAuth) segments referral sessions from chatgpt.com, perplexity.ai, copilot.microsoft.com, claude.ai, gemini.google.com → `AiReferralDaily`.
- **AI readiness score (0–100)** computed from crawl data (§9.2): AI crawlers not blocked in robots.txt, llms.txt present, structured data valid, content server-rendered, sitemap valid.
- Tables: `AiCrawlerStat (id, site_id, date, bot, hits, sample_paths jsonb)`, `AiReferralDaily (id, site_id, date, source, sessions)`.

### 10.2 AI incident briefs + review drafts (Phase 2 — Claude API, Haiku)
- On critical/warning alert creation, job `ai.brief`: send alert + last 20 timeline events + site context (WP/PHP versions, recent updates) to Claude (AI_MODEL_FAST) → 3–5 sentence explanation + suggested fix steps. Store in `AiInsight`, render under the alert.
- On new GBP review ≤3 stars: generate 3 reply drafts (apologetic/professional/brief).
- Caching + idempotency (one brief per alert); per-org monthly quota by plan (e.g., 100 briefs on $19, 500 on $49); graceful degradation if quota hit or API down (alert still works without brief).
- Table: `AiInsight (id, site_id, alert_id nullable, kind[brief|review_draft|report_narrative|chat], model, prompt_tokens, completion_tokens, content text, created_at)`.
- **Security:** API key backend-only; never send WP credentials, user emails, or site keys in prompts; strip PII from event payloads before prompting.

### 10.3 AI report narratives (Phase 2, with PDF reports)
- Monthly job: stats summary JSON → Claude (AI_MODEL_SMART) → client-friendly executive summary paragraph + "what we did" bullets for the white-label PDF. One call per site per month.

### 10.4 Answer-presence checks + ask-your-sites chat (Phase 3)
- `ai.presence` weekly job: per tracked query (quota: 10/site on top plan), call Claude with web search enabled, ask the query as a consumer would, parse whether client domain/brand is mentioned and/or cited; store mentioned/cited/competitors in `AiQueryCheck (id, site_id, query, checked_at, mentioned bool, cited bool, competitors jsonb, excerpt text)`. Alert when a previously-mentioned query loses its mention (warning).
- Ask-your-sites chat: app sends question → backend resolves which data is needed (sites list, events, uptime, SEO daily) via a small tool-use loop with Claude → returns grounded answer. Read-only data access, org-scoped, rate-limited (20 questions/day). No write actions ever.

### 10.5 AI cost guardrails
- Hard monthly token budget per org enforced in backend; usage tracked in AiInsight token columns.
- All AI calls async via BullMQ (never block alert delivery on an AI call).
- Target: < $3/customer/month AI spend on the $49 plan.
