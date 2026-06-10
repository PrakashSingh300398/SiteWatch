<?php
/**
 * Buffers WordPress events in a local DB table and flushes them to the backend.
 *
 * Flush strategy:
 *  - Regular: WP-Cron fires `sitewatch_flush_events` every 60 s.
 *  - Immediate: critical events schedule a shutdown-hook flush for the current request.
 */
class SiteWatch_Event_Queue {

	/** @var string */
	private $table;

	/** @var bool Whether a critical event has been queued this request */
	private $has_critical = false;

	const BATCH_SIZE    = 50;
	const MAX_ATTEMPTS  = 5;

	public function __construct() {
		global $wpdb;
		$this->table = $wpdb->prefix . 'sitewatch_queue';
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Add a WordPress event to the queue.
	 *
	 * @param string $type     Dot-separated event type, e.g. 'user.created'.
	 * @param string $severity One of info|warning|critical.
	 * @param array  $data     Event-specific payload fields.
	 */
	public function push( $type, $severity, array $data ) {
		global $wpdb;

		$actor = $this->get_actor();

		$payload = array(
			'type'          => $type,
			'severity_hint' => $severity,
			'occurred_at'   => gmdate( 'Y-m-d\TH:i:s\Z' ),
			'actor'         => $actor,
			'data'          => $data,
			'request'       => array(
				'ip'         => $actor['ip'],
				'user_agent' => isset( $_SERVER['HTTP_USER_AGENT'] )
					? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) )
					: '',
			),
		);

		$wpdb->insert(
			$this->table,
			array(
				'event_type'  => $type,
				'severity'    => $severity,
				'occurred_at' => current_time( 'mysql', true ),
				'payload'     => wp_json_encode( $payload ),
				'attempts'    => 0,
			),
			array( '%s', '%s', '%s', '%s', '%d' )
		);

		if ( 'critical' === $severity ) {
			$this->has_critical = true;
			// Flush on shutdown so the critical event ships before the process dies
			if ( ! has_action( 'shutdown', array( $this, 'flush_if_critical' ) ) ) {
				add_action( 'shutdown', array( $this, 'flush_if_critical' ), 20 );
			}
		}
	}

	/** Called on shutdown to flush any pending critical events. */
	public function flush_if_critical() {
		if ( $this->has_critical ) {
			self::do_flush();
		}
	}

	// ── Cron entry point ──────────────────────────────────────────────────────

	public static function flush_cron() {
		self::do_flush();
	}

	// ── Core flush logic ──────────────────────────────────────────────────────

	public static function do_flush() {
		global $wpdb;

		$table  = $wpdb->prefix . 'sitewatch_queue';
		$client = new SiteWatch_API_Client();

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"SELECT * FROM {$table} WHERE attempts < %d ORDER BY occurred_at ASC LIMIT %d",
				self::MAX_ATTEMPTS,
				self::BATCH_SIZE
			)
		);

		if ( empty( $rows ) ) {
			return;
		}

		$events = array();
		$ids    = array();

		foreach ( $rows as $row ) {
			$payload = json_decode( $row->payload, true );
			if ( ! empty( $payload ) ) {
				$events[] = $payload;
				$ids[]    = (int) $row->id;
			}
		}

		if ( empty( $events ) ) {
			return;
		}

		$success = $client->post_events( $events );

		if ( $success ) {
			// Remove successfully delivered events
			$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE id IN ({$placeholders})", $ids ) );
			update_option( 'sitewatch_last_sync', current_time( 'mysql', true ), false );
		} else {
			// Increment retry counter
			$placeholders = implode( ',', array_fill( 0, count( $ids ), '%d' ) );
			// phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
			$wpdb->query( $wpdb->prepare( "UPDATE {$table} SET attempts = attempts + 1 WHERE id IN ({$placeholders})", $ids ) );

			// Prune permanently failed events older than 24 h
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->query( "DELETE FROM {$table} WHERE attempts >= " . self::MAX_ATTEMPTS . " AND occurred_at < DATE_SUB(NOW(), INTERVAL 1 DAY)" );
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private function get_actor() {
		$user = wp_get_current_user();
		return array(
			'user_id'    => (int) $user->ID,
			'user_login' => (string) $user->user_login,
			'ip'         => isset( $_SERVER['REMOTE_ADDR'] )
				? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) )
				: '',
		);
	}
}
