-- CreateEnum
CREATE TYPE "OrgPlan" AS ENUM ('starter', 'pro', 'agency');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "SiteStatus" AS ENUM ('up', 'down', 'unknown');

-- CreateEnum
CREATE TYPE "EventSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "VitalsStrategy" AS ENUM ('mobile', 'desktop');

-- CreateEnum
CREATE TYPE "AiInsightKind" AS ENUM ('brief', 'review_draft', 'report_narrative', 'chat');

-- CreateEnum
CREATE TYPE "GscConnectionStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "OrgPlan" NOT NULL DEFAULT 'starter',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "expo_push_tokens" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "site_key_hash" TEXT,
    "status" "SiteStatus" NOT NULL DEFAULT 'unknown',
    "paired_at" TIMESTAMP(3),
    "last_check_at" TIMESTAMP(3),
    "last_health_at" TIMESTAMP(3),
    "wp_version" TEXT,
    "php_version" TEXT,
    "security_score" INTEGER,
    "check_interval_sec" INTEGER NOT NULL DEFAULT 300,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uptime_checks" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL,
    "status_code" INTEGER,
    "response_ms" INTEGER,
    "error" TEXT,

    CONSTRAINT "uptime_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uptime_rollups" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "checks_total" INTEGER NOT NULL DEFAULT 0,
    "checks_ok" INTEGER NOT NULL DEFAULT 0,
    "avg_ms" DOUBLE PRECISION,

    CONSTRAINT "uptime_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ssl_statuses" (
    "site_id" TEXT NOT NULL,
    "issuer" TEXT,
    "expires_at" TIMESTAMP(3),
    "grade" TEXT,
    "last_checked_at" TIMESTAMP(3),

    CONSTRAINT "ssl_statuses_pkey" PRIMARY KEY ("site_id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "EventSeverity" NOT NULL DEFAULT 'info',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "actor" JSONB,
    "data" JSONB,
    "ip" TEXT,
    "geo" JSONB,
    "correlated_event_id" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plugins" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "update_available" BOOLEAN NOT NULL DEFAULT false,
    "new_version" TEXT,
    "vulnerable" BOOLEAN NOT NULL DEFAULT false,
    "vuln_data" JSONB,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plugins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_monitors" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "form_plugin" TEXT NOT NULL,
    "form_id" TEXT NOT NULL,
    "form_name" TEXT NOT NULL,
    "baseline_daily" DECIMAL(65,30),
    "count_24h" INTEGER NOT NULL DEFAULT 0,
    "count_7d" INTEGER NOT NULL DEFAULT 0,
    "last_entry_at" TIMESTAMP(3),
    "alert_state" TEXT,

    CONSTRAINT "form_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "event_id" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "known_ips" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "user_login" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "country" TEXT,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_ips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_vitals" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performance" INTEGER,
    "lcp_ms" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "inp_ms" DOUBLE PRECISION,
    "strategy" "VitalsStrategy" NOT NULL DEFAULT 'mobile',

    CONSTRAINT "web_vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gsc_connections" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "google_email" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "property_url" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "GscConnectionStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "gsc_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_daily" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION,
    "avg_position" DOUBLE PRECISION,

    CONSTRAINT "seo_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_queries" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION,
    "is_priority" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "seo_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_index_statuses" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "indexed_count" INTEGER NOT NULL DEFAULT 0,
    "excluded_noindex" INTEGER NOT NULL DEFAULT 0,
    "crawled_not_indexed" INTEGER NOT NULL DEFAULT 0,
    "server_errors" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seo_index_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_pages" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "crawled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "meta_desc" TEXT,
    "canonical" TEXT,
    "robots" TEXT,
    "h1" TEXT,
    "issues" JSONB,

    CONSTRAINT "crawl_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_audit_summaries" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "crawled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER,
    "issue_counts" JSONB,

    CONSTRAINT "seo_audit_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_crawler_stats" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "bot" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "sample_paths" JSONB,

    CONSTRAINT "ai_crawler_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_referral_daily" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_referral_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "alert_id" TEXT,
    "kind" "AiInsightKind" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "uptime_checks_site_id_checked_at_idx" ON "uptime_checks"("site_id", "checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "uptime_rollups_site_id_hour_key" ON "uptime_rollups"("site_id", "hour");

-- CreateIndex
CREATE INDEX "events_site_id_occurred_at_idx" ON "events"("site_id", "occurred_at");

-- CreateIndex
CREATE INDEX "events_site_id_severity_idx" ON "events"("site_id", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "plugins_site_id_slug_key" ON "plugins"("site_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "form_monitors_site_id_form_plugin_form_id_key" ON "form_monitors"("site_id", "form_plugin", "form_id");

-- CreateIndex
CREATE INDEX "alerts_org_id_resolved_at_idx" ON "alerts"("org_id", "resolved_at");

-- CreateIndex
CREATE INDEX "alerts_site_id_resolved_at_idx" ON "alerts"("site_id", "resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "known_ips_site_id_user_login_ip_key" ON "known_ips"("site_id", "user_login", "ip");

-- CreateIndex
CREATE INDEX "web_vitals_site_id_measured_at_idx" ON "web_vitals"("site_id", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "gsc_connections_site_id_key" ON "gsc_connections"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "seo_daily_site_id_date_key" ON "seo_daily"("site_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "seo_queries_site_id_date_query_key" ON "seo_queries"("site_id", "date", "query");

-- CreateIndex
CREATE UNIQUE INDEX "seo_index_statuses_site_id_date_key" ON "seo_index_statuses"("site_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "crawl_pages_site_id_url_key" ON "crawl_pages"("site_id", "url");

-- CreateIndex
CREATE UNIQUE INDEX "ai_crawler_stats_site_id_date_bot_key" ON "ai_crawler_stats"("site_id", "date", "bot");

-- CreateIndex
CREATE UNIQUE INDEX "ai_referral_daily_site_id_date_source_key" ON "ai_referral_daily"("site_id", "date", "source");

-- CreateIndex
CREATE INDEX "ai_insights_site_id_created_at_idx" ON "ai_insights"("site_id", "created_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uptime_checks" ADD CONSTRAINT "uptime_checks_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uptime_rollups" ADD CONSTRAINT "uptime_rollups_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ssl_statuses" ADD CONSTRAINT "ssl_statuses_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_correlated_event_id_fkey" FOREIGN KEY ("correlated_event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plugins" ADD CONSTRAINT "plugins_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_monitors" ADD CONSTRAINT "form_monitors_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_ips" ADD CONSTRAINT "known_ips_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_vitals" ADD CONSTRAINT "web_vitals_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_daily" ADD CONSTRAINT "seo_daily_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_queries" ADD CONSTRAINT "seo_queries_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_index_statuses" ADD CONSTRAINT "seo_index_statuses_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seo_audit_summaries" ADD CONSTRAINT "seo_audit_summaries_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_crawler_stats" ADD CONSTRAINT "ai_crawler_stats_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_referral_daily" ADD CONSTRAINT "ai_referral_daily_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
