<?php
/**
 * Detects AI crawler requests and aggregates daily counts (spec §10.1).
 *
 * Count-only, privacy-light: stores bot name + daily hit count + up to 10 sample paths.
 * Historical data starts accumulating from plugin activation and becomes valuable
 * when the AI module ships in Phase 2.
 *
 * Batched to backend daily via sitewatch_flush_ai_stats cron.
 */
class SiteWatch_AI_Crawler {

	const MAX_SAMPLE_PATHS = 10;

	/**
	 * Maintained list of AI crawler User-Agent substrings (spec §10.1).
	 * Update this list as new bots emerge; backend can push updates in Phase 2.
	 */
	const BOTS = array(
		'GPTBot',
		'OAI-SearchBot',
		'ChatGPT-User',
		'ClaudeBot',
		'Claude-User',
		'PerplexityBot',
		'Google-Extended',
		'Bytespider',
		'Amazonbot',
		'Applebot-Extended',
		'Diffbot',
		'FacebookBot',
		'cohere-ai',
		'anthropic-ai',
		'AI2Bot',
	);

	// ── Per-request detection ─────────────────────────────────────────────────

	public function maybe_log_crawler() {
		// Run only on real page requests, not admin/cron/REST
		if ( is_admin() || ( defined( 'DOING_CRON' ) && DOING_CRON ) ) {
			return;
		}

		$ua = isset( $_SERVER['HTTP_USER_AGENT'] )
			? sanitize_text_field( wp_unslash( $_SERVER['HTTP_USER_AGENT'] ) )
			: '';

		if ( ! $ua ) {
			return;
		}

		$bot = $this->detect_bot( $ua );
		if ( ! $bot ) {
			return;
		}

		$this->record( $bot );
	}

	private function detect_bot( $ua ) {
		foreach ( self::BOTS as $bot ) {
			if ( false !== stripos( $ua, $bot ) ) {
				return $bot;
			}
		}
		return null;
	}

	private function record( $bot ) {
		global $wpdb;
		$table = $wpdb->prefix . 'sitewatch_ai_crawlers';
		$today = current_time( 'Y-m-d' );
		$path  = isset( $_SERVER['REQUEST_URI'] )
			? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) )
			: '/';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$existing = $wpdb->get_row(
			$wpdb->prepare(
				"SELECT id, hits, sample_paths FROM {$table} WHERE bot = %s AND date = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$bot,
				$today
			)
		);

		if ( $existing ) {
			$paths = json_decode( $existing->sample_paths ?? '[]', true );
			if ( ! is_array( $paths ) ) {
				$paths = array();
			}
			if ( ! in_array( $path, $paths, true ) && count( $paths ) < self::MAX_SAMPLE_PATHS ) {
				$paths[] = $path;
			}
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->update(
				$table,
				array(
					'hits'         => (int) $existing->hits + 1,
					'sample_paths' => wp_json_encode( $paths ),
				),
				array( 'id' => (int) $existing->id ),
				array( '%d', '%s' ),
				array( '%d' )
			);
		} else {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->insert(
				$table,
				array(
					'bot'          => $bot,
					'date'         => $today,
					'hits'         => 1,
					'sample_paths' => wp_json_encode( array( $path ) ),
				),
				array( '%s', '%s', '%d', '%s' )
			);
		}
	}

	// ── Daily cron flush ──────────────────────────────────────────────────────

	public static function flush_cron() {
		global $wpdb;

		$table     = $wpdb->prefix . 'sitewatch_ai_crawlers';
		$yesterday = gmdate( 'Y-m-d', time() - DAY_IN_SECONDS );

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT * FROM {$table} WHERE date = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				$yesterday
			)
		);

		if ( empty( $rows ) ) {
			return;
		}

		$client = new SiteWatch_API_Client();
		$events = array();

		foreach ( $rows as $row ) {
			$events[] = array(
				'type'          => 'ai.crawler_stat',
				'severity_hint' => 'info',
				'occurred_at'   => $yesterday . 'T00:00:00Z',
				'actor'         => new stdClass(),
				'data'          => array(
					'bot'          => $row->bot,
					'date'         => $row->date,
					'hits'         => (int) $row->hits,
					'sample_paths' => json_decode( $row->sample_paths ?? '[]', true ),
				),
				'request'       => new stdClass(),
			);
		}

		$success = $client->post_events( $events );

		if ( $success ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$wpdb->query(
				$wpdb->prepare(
					"DELETE FROM {$table} WHERE date = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
					$yesterday
				)
			);
		}
	}
}
