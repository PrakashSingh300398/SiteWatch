<?php
/**
 * Registers GET /wp-json/sitewatch/v1/health — the only inbound REST route.
 *
 * Access requires a valid HMAC-SHA256 signature from the backend (spec §3.1).
 * Verification mirrors the backend's signRequest() in lib/hmac.ts:
 *   message = "{timestamp_ms}." (body is empty for a GET request)
 *   expected = hash_hmac('sha256', message, site_key)
 */
class SiteWatch_REST {

	const REPLAY_WINDOW_MS = 300000; // 5 minutes

	public function register_routes() {
		register_rest_route(
			'sitewatch/v1',
			'/health',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'health_handler' ),
				'permission_callback' => array( $this, 'verify_backend_hmac' ),
			)
		);
	}

	// ── Permission callback ────────────────────────────────────────────────────

	public function verify_backend_hmac( WP_REST_Request $request ) {
		$signature = $request->get_header( 'X-SiteWatch-Signature' );
		$timestamp = $request->get_header( 'X-SiteWatch-Timestamp' );

		if ( ! $signature || ! $timestamp ) {
			return false;
		}

		$site_key = (string) get_option( 'sitewatch_site_key', '' );
		if ( ! $site_key ) {
			return false;
		}

		// Replay window: reject if request is older than 5 minutes
		$now_ms = (int) round( microtime( true ) * 1000 );
		$ts_ms  = (int) $timestamp;
		if ( abs( $now_ms - $ts_ms ) > self::REPLAY_WINDOW_MS ) {
			return false;
		}

		// GET request → empty body; message = "{timestamp}."
		$message  = $timestamp . '.';
		$expected = hash_hmac( 'sha256', $message, $site_key );
		$provided = str_replace( 'sha256=', '', $signature );

		return hash_equals( $expected, $provided );
	}

	// ── Route handler ─────────────────────────────────────────────────────────

	public function health_handler( WP_REST_Request $request ) { // phpcs:ignore VariableAnalysis
		$health = new SiteWatch_Health();
		return rest_ensure_response( $health->snapshot() );
	}
}
