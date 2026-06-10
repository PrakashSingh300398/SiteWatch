<?php
/**
 * Handles database table creation, cron scheduling, and full cleanup on uninstall.
 */
class SiteWatch_DB {

	const QUEUE_TABLE   = 'sitewatch_queue';
	const AI_TABLE      = 'sitewatch_ai_crawlers';

	// ── Activation ────────────────────────────────────────────────────────────

	public static function activate() {
		global $wpdb;

		$charset = $wpdb->get_charset_collate();
		$queue   = $wpdb->prefix . self::QUEUE_TABLE;
		$ai      = $wpdb->prefix . self::AI_TABLE;

		$sql = "CREATE TABLE {$queue} (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			event_type varchar(100) NOT NULL,
			severity varchar(20) NOT NULL DEFAULT 'info',
			occurred_at datetime NOT NULL,
			payload longtext NOT NULL,
			attempts tinyint(3) UNSIGNED NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY event_type (event_type),
			KEY occurred_at (occurred_at)
		) {$charset};

		CREATE TABLE {$ai} (
			id bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT,
			bot varchar(100) NOT NULL,
			date date NOT NULL,
			hits int(10) UNSIGNED NOT NULL DEFAULT 0,
			sample_paths longtext,
			PRIMARY KEY  (id),
			UNIQUE KEY bot_date (bot, date)
		) {$charset};";

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta( $sql );

		// Generate site key once on activation (64 hex chars = 32 random bytes)
		if ( ! get_option( 'sitewatch_site_key' ) ) {
			update_option( 'sitewatch_site_key', bin2hex( random_bytes( 32 ) ), false );
		}

		// Schedule recurring flush jobs
		if ( ! wp_next_scheduled( 'sitewatch_flush_events' ) ) {
			wp_schedule_event( time(), 'sitewatch_1min', 'sitewatch_flush_events' );
		}
		if ( ! wp_next_scheduled( 'sitewatch_flush_ai_stats' ) ) {
			wp_schedule_event( time(), 'daily', 'sitewatch_flush_ai_stats' );
		}
	}

	// ── Deactivation ──────────────────────────────────────────────────────────

	public static function deactivate() {
		wp_clear_scheduled_hook( 'sitewatch_flush_events' );
		wp_clear_scheduled_hook( 'sitewatch_flush_ai_stats' );
	}

	// ── Uninstall ─────────────────────────────────────────────────────────────

	public static function uninstall() {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . self::QUEUE_TABLE );
		// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		$wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . self::AI_TABLE );

		delete_option( 'sitewatch_site_key' );
		delete_option( 'sitewatch_site_id' );
		delete_option( 'sitewatch_backend_url' );
		delete_option( 'sitewatch_paired_at' );
		delete_option( 'sitewatch_last_sync' );
	}
}
