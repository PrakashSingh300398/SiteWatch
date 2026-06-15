ALTER TABLE "organizations" ADD COLUMN "notif_prefs" JSONB NOT NULL DEFAULT '{"push_critical":true,"push_warning":true,"push_info":false,"quiet_start":null,"quiet_end":null,"quiet_tz":"UTC"}';
