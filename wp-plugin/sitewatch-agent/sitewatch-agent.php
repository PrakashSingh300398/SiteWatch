<?php
/**
 * Plugin Name:       SiteWatch Agent
 * Plugin URI:        https://sitewatch.example
 * Description:       WordPress monitoring agent for SiteWatch — reports site health, security events, and AI crawler traffic to the SiteWatch backend.
 * Version:           1.3.1
 * Author:            Prakash Singh / Code to Click
 * Author URI:        https://codetoclick.ca
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Text Domain:       sitewatch-agent
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'SITEWATCH_VERSION', '1.3.1' );
define( 'SITEWATCH_PLUGIN_FILE', __FILE__ );
define( 'SITEWATCH_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

// ── Autoload includes ─────────────────────────────────────────────────────────
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-db.php';
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-api-client.php';
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-event-queue.php';
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-event-hooks.php';
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-health.php';
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-rest.php';
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-ai-crawler.php';
require_once SITEWATCH_PLUGIN_DIR . 'includes/class-integrity.php';
require_once SITEWATCH_PLUGIN_DIR . 'admin/class-settings-page.php';

// ── Lifecycle hooks ───────────────────────────────────────────────────────────
register_activation_hook( __FILE__, array( 'SiteWatch_DB', 'activate' ) );
register_activation_hook( __FILE__, array( 'SiteWatch_Integrity', 'schedule' ) );
register_deactivation_hook( __FILE__, array( 'SiteWatch_DB', 'deactivate' ) );
register_deactivation_hook( __FILE__, array( 'SiteWatch_Integrity', 'unschedule' ) );
register_uninstall_hook( __FILE__, array( 'SiteWatch_DB', 'uninstall' ) );

// ── Custom cron interval (1 min) ──────────────────────────────────────────────
add_filter(
	'cron_schedules',
	function ( $schedules ) {
		if ( ! isset( $schedules['sitewatch_1min'] ) ) {
			$schedules['sitewatch_1min'] = array(
				'interval' => 60,
				'display'  => esc_html__( 'Every minute', 'sitewatch-agent' ),
			);
		}
		return $schedules;
	}
);

// ── Bootstrap ─────────────────────────────────────────────────────────────────
add_action( 'plugins_loaded', 'sitewatch_init' );

function sitewatch_init() {
	// REST endpoint (always registered so WP REST discovery works)
	$rest = new SiteWatch_REST();
	add_action( 'rest_api_init', array( $rest, 'register_routes' ) );

	// Admin settings page
	if ( is_admin() ) {
		$settings_page = new SiteWatch_Settings_Page();
		$settings_page->init();
	}

	// Event hooks + cron callbacks only when site is paired
	if ( get_option( 'sitewatch_site_id' ) ) {
		$queue = new SiteWatch_Event_Queue();
		$hooks = new SiteWatch_Event_Hooks( $queue );
		$hooks->register();

		// AI crawler detection on every public request (init fires early)
		$ai = new SiteWatch_AI_Crawler();
		add_action( 'init', array( $ai, 'maybe_log_crawler' ), 1 );
	}

	// Cron callbacks (must always be registered so WP can call them)
	add_action( 'sitewatch_flush_events', array( 'SiteWatch_Event_Queue', 'flush_cron' ) );
	add_action( 'sitewatch_flush_ai_stats', array( 'SiteWatch_AI_Crawler', 'flush_cron' ) );
	add_action( 'sitewatch_integrity_scan', array( 'SiteWatch_Integrity', 'run_cron' ) );

	// Schedule integrity scan if it's not yet scheduled (handles first boot after upgrade)
	if ( get_option( 'sitewatch_site_id' ) ) {
		SiteWatch_Integrity::schedule();
	}
}
