<?php
/**
 * Registers the WP Admin settings page for SiteWatch.
 *
 * Provides: backend URL config, pairing-code input, connection status,
 * last sync timestamp, and a disconnect button.
 * No data is ever displayed to non-admin users.
 */
class SiteWatch_Settings_Page {

	public function init() {
		add_action( 'admin_menu',          array( $this, 'add_menu' ) );
		add_action( 'admin_post_sitewatch_save',       array( $this, 'handle_save' ) );
		add_action( 'admin_post_sitewatch_pair',       array( $this, 'handle_pair' ) );
		add_action( 'admin_post_sitewatch_disconnect', array( $this, 'handle_disconnect' ) );
	}

	public function add_menu() {
		add_menu_page(
			esc_html__( 'SiteWatch', 'sitewatch-agent' ),
			esc_html__( 'SiteWatch', 'sitewatch-agent' ),
			'manage_options',
			'sitewatch',
			array( $this, 'render' ),
			'dashicons-shield-alt',
			80
		);
	}

	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Insufficient permissions.', 'sitewatch-agent' ) );
		}
		require_once SITEWATCH_PLUGIN_DIR . 'admin/view-settings.php';
	}

	// ── Form handlers ─────────────────────────────────────────────────────────

	/** Save backend URL. */
	public function handle_save() {
		$this->check_referer( 'sitewatch_save' );

		$backend_url = isset( $_POST['sitewatch_backend_url'] )
			? esc_url_raw( wp_unslash( $_POST['sitewatch_backend_url'] ) )
			: '';
		update_option( 'sitewatch_backend_url', $backend_url );

		wp_safe_redirect( add_query_arg( array( 'page' => 'sitewatch', 'saved' => '1' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	/** Pair with backend using a 6-char pairing code. */
	public function handle_pair() {
		$this->check_referer( 'sitewatch_pair' );

		$code = strtoupper( sanitize_text_field( wp_unslash( isset( $_POST['sitewatch_pairing_code'] ) ? $_POST['sitewatch_pairing_code'] : '' ) ) );

		if ( 6 !== strlen( $code ) || ! ctype_alnum( $code ) ) {
			wp_safe_redirect( add_query_arg( array( 'page' => 'sitewatch', 'sw_error' => 'invalid_code' ), admin_url( 'admin.php' ) ) );
			exit;
		}

		$client = new SiteWatch_API_Client();
		$result = $client->pair( $code );

		if ( $result['ok'] ) {
			update_option( 'sitewatch_site_id', sanitize_text_field( $result['siteId'] ), false );
			update_option( 'sitewatch_paired_at', current_time( 'mysql', true ), false );
			wp_safe_redirect( add_query_arg( array( 'page' => 'sitewatch', 'paired' => '1' ), admin_url( 'admin.php' ) ) );
		} else {
			wp_safe_redirect( add_query_arg( array( 'page' => 'sitewatch', 'sw_error' => rawurlencode( $result['error'] ?? 'pairing_failed' ) ), admin_url( 'admin.php' ) ) );
		}
		exit;
	}

	/** Remove pairing data (disconnect without touching the site key). */
	public function handle_disconnect() {
		$this->check_referer( 'sitewatch_disconnect' );

		delete_option( 'sitewatch_site_id' );
		delete_option( 'sitewatch_paired_at' );
		delete_option( 'sitewatch_last_sync' );

		wp_safe_redirect( add_query_arg( array( 'page' => 'sitewatch', 'disconnected' => '1' ), admin_url( 'admin.php' ) ) );
		exit;
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	private function check_referer( $action ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Insufficient permissions.', 'sitewatch-agent' ) );
		}
		check_admin_referer( $action );
	}
}
