# SiteWatch — Phase 2 Build Guide (for Claude Code)

Phase 1 is done: monitoring core, security/audit, alerts, mobile app, push.
Phase 2 layers on the features that justify the $49 plan: form monitoring,
performance, reports, the SEO module (§9 of sitewatch-spec.md), and the AI
features (§10). Build in the order below — each session is self-contained,
testable, and ends before the next begins.

**Golden rules (same as Phase 1):**
- One session = one step. Commit to git after each working step.
- After every change: "run the test suite and fix failures before showing me."
- Still NO remote-action endpoints. Read-only everywhere. (spec §4.6)
- The full feature detail lives in sitewatch-spec.md §9 and §10 — Claude Code
  should re-read those sections at the start of the relevant session.
- Keep testing against your staging site, not live client sites.

---

## Pre-flight (get these before starting — ~30 min)

- **Google Cloud project** with OAuth consent screen configured (External, test
  mode is fine to start). Enable: Search Console API, PageSpeed Insights API,
  Google Analytics Data API. Create an OAuth 2.0 Client ID (Web type) and put
  the client id/secret in your backend env (`GOOGLE_OAUTH_CLIENT_ID/SECRET`).
- **PageSpeed Insights API key** (separate simple API key) → `PSI_API_KEY`.
- **Anthropic API key** → `ANTHROPIC_API_KEY` (backend only, never in the app).
- Confirm your staging site has Search Console verified for the same Google
  account you'll connect with, so you have real data to test against.

---

## Session 7 — Form monitoring + Core Web Vitals

```
Read sitewatch-spec.md sections 3.3, 4.3, and 5.1. We're starting Phase 2.

Implement form monitoring and Core Web Vitals:
1. Extend the WP agent plugin health snapshot (3.3) to report Gravity Forms,
   WPForms, and CF7 per-form submission counts for 24h/7d, degrading
   gracefully when a plugin isn't present.
2. Backend: the forms.watch hourly job with trailing-14-day baseline learning
   and the "submissions stopped" warning rule (3 days zero vs baseline >=1/day).
3. Backend: the vitals.fetch weekly job using the PageSpeed Insights API
   (mobile strategy), storing into the WebVitals table.
4. Mobile: add the Forms tab and Vitals tab to site detail per section 5.1,
   with the CWV trend chart.

Write tests for the baseline/stopped-form logic. Show me how to test by
faking entry counts on my staging site.
```

Test: confirm a form going quiet for 3 days triggers a warning, and CWV scores appear per site.

---

## Session 8 — Daily digests + integrity scans

```
Read sitewatch-spec.md sections 3.4, 4.3, 4.4.

Implement:
1. The digest.daily job (4.3): email + push summary of info-level events and
   open warnings, sent at the org's configured local time. Use the configured
   email provider (Resend or SMTP).
2. Integrity scanning in the WP agent plugin (3.4): daily WP-Cron core file
   checksum comparison against api.wordpress.org, plus the uploads-folder PHP
   file scan. Report findings as events; a PHP file in uploads is critical.
3. Wire the new integrity events into the alert engine (4.4 critical tier).

Respect the 30-second scan budget in 3.4 so shared hosting isn't hurt.
Test the checksum check by modifying a core file on staging.
```

---

## Session 9 — White-label PDF reports + team members

```
Read sitewatch-spec.md sections 4.2 (Reports endpoint) and 5.1 (Settings).

Implement:
1. Monthly white-label PDF report generation per site: uptime %, incidents and
   resolutions, updates applied, security score trend, form activity, CWV.
   Agency logo + custom color. Use a server-side PDF approach (e.g. Playwright
   render of an HTML template, or pdfkit). Endpoint GET /v1/sites/:id/report.
2. Team members: invite by email, member vs owner roles, shared alerts.
   Enforce org scoping (4.6). Add the team section to mobile Settings.

Leave a placeholder in the report for an AI-written executive summary; we add
that in Session 12. Generate a sample PDF for my staging site so I can see it.
```

---

## Session 10 — SEO module: Google Search Console

```
Read sitewatch-spec.md section 9.1 and 9.3 carefully.

Implement the GSC integration:
1. Google OAuth 2.0 flow: mobile opens browser, backend handles callback,
   store the refresh token ENCRYPTED (AES-256-GCM) in GscConnection.
2. The gsc.pull daily job: Search Analytics API (clicks, impressions, CTR,
   avg position; top 25 queries; top 25 pages) into SeoDaily/SeoQuery, plus
   index status into SeoIndexStatus.
3. SEO alert rules from 9.3: clicks down >30% WoW, indexed-page drop >10%
   (critical), priority query out of top 10, GSC connection revoked.
4. Mobile: add the SEO tab to site detail — clicks/impressions/position trend,
   indexing status, with the traffic-drop / index-drop alerts surfaced.

Test against my staging site's real Search Console data. Write tests for the
WoW drop calculations.
```

Test: connect your staging site's GSC, confirm real traffic numbers appear.

---

## Session 11 — SEO module: technical crawler

```
Read sitewatch-spec.md section 9.2 and 9.3.

Implement the weekly technical SEO crawler:
1. The seo.crawl job: fetch sitemap.xml, crawl up to 100 pages/site at
   1 req/sec identifying as SiteWatchBot, parse with cheerio, capture
   title/meta/canonical/robots/H1/internal-link-status/alt/JSON-LD into
   CrawlPage, and compute SeoAuditSummary.
2. Findings: missing/duplicate titles & metas, missing H1, broken internal
   links, accidental noindex/nofollow, robots.txt issues, invalid sitemap.
3. Change detection: diff title/meta/canonical/robots vs previous crawl and
   emit seo.* events onto the activity timeline.
4. The sitewide-noindex critical rule and broken-links warning from 9.3.
5. Mobile: show the technical audit findings list in the SEO tab.

Test by introducing a broken link and a noindex on staging, then re-crawling.
```

---

## Session 12 — AI features: crawler tracking, incident briefs, report narratives

```
Read sitewatch-spec.md section 10 in full.

Implement (all Anthropic calls backend-only, async via BullMQ, never blocking
alert delivery; strip PII from prompts per 10.2):
1. AI crawler tracking (10.1): confirm the agent is logging GPTBot/ClaudeBot/
   PerplexityBot/Google-Extended etc. user-agents (count-only, daily batch)
   into AiCrawlerStat; add GA4 AI-referral segmentation into AiReferralDaily;
   compute the AI readiness score from crawl data; add the AI tab to mobile.
2. AI incident briefs (10.2): the ai.brief job using AI_MODEL_FAST (Haiku) —
   on critical/warning alerts, generate a 3-5 sentence explanation + fix steps
   into AiInsight, rendered under the alert. Add per-org monthly quotas and
   graceful degradation.
3. AI report narratives (10.3): fill the Session 9 PDF placeholder using
   AI_MODEL_SMART — client-friendly summary + "what we did" bullets.
4. Cost guardrails from 10.5: token budget per org, usage tracked in AiInsight.

Test an incident brief by triggering a staging outage; show me the generated
text and the token cost logged.
```

---

## Phase 2 definition of done

- A staging form going silent for 3 days produces a warning.
- Monthly PDF report generates with agency branding and an AI-written summary.
- Staging site's real GSC traffic shows in the SEO tab; a simulated traffic
  drop fires an alert.
- The crawler flags a broken link and a noindex you introduced, and the change
  shows on the activity timeline.
- Triggering a staging outage produces an AI incident brief within ~1 minute,
  with token cost logged and under quota.
- AI crawler visits (GPTBot etc.) show real counts in the AI tab.

Live with Phase 2 on your own sites for 2-3 weeks. THEN, before Phase 3
(billing, web dashboard, GBP, answer-presence, ask-your-sites chat), do the
validation step: get 3 other Calgary agency owners to try it. If they'd pay,
build Phase 3 and start charging. If not, you still have a tool that makes your
own agency better — no loss.

---

## Deferred to Phase 3 (do NOT build now)
- Stripe billing + multi-tenant plan enforcement
- Web dashboard (reuse the same API)
- Google Business Profile reviews (§9.4)
- AI answer-presence checks + ask-your-sites chat (§10.4)
- Keyword rank tracking via DataForSEO
- Remote actions (with confirmation tokens) — biggest security surface, last
