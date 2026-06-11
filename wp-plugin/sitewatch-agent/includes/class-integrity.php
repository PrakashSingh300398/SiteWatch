<?php
/**
 * Daily integrity scan: WP core checksums + uploads PHP file detection.
 *
 * Respects a 30-second budget per spec §3.4 so shared hosting isn't hurt.
 * Results are reported as events to the SiteWatch backend.
 */
class SiteWatch_Integrity {

	const SCAN_BUDGET_SEC = 28; // leave 2s headroom below the 30s spec limit

	/**
	 * Entry point called by WP-Cron.
	 */
	public static function run_cron() {
		if ( ! get_option( 'sitewatch_site_id' ) ) {
			return;
		}

		$self = new self();
		$self->run();
	}

	public function run() {
		$start  = time();
		$events = array();

		$core_events   = $this->check_core_checksums( $start );
		$events        = array_merge( $events, $core_events );

		// Only proceed to uploads scan if we have budget left
		if ( time() - $start < self::SCAN_BUDGET_SEC ) {
			$upload_events = $this->scan_uploads_php( $start );
			$events        = array_merge( $events, $upload_events );
		}

		if ( ! empty( $events ) ) {
			$client = new SiteWatch_API_Client();
			$client->post_events( $events );
		}

		// Track last run time so settings page can show it
		update_option( 'sitewatch_last_integrity_scan', time(), false );
	}

	// ── Core checksum comparison ───────────────────────────────────────────────

	private function check_core_checksums( $start ) {
		global $wp_version;

		$locale = get_locale();
		$url    = add_query_arg(
			array(
				'version' => $wp_version,
				'locale'  => $locale,
			),
			'https://api.wordpress.org/core/checksums/1.0/'
		);

		$response = wp_remote_get( $url, array( 'timeout' => 10 ) );
		if ( is_wp_error( $response ) ) {
			return array();
		}

		$body = json_decode( wp_remote_retrieve_body( $response ), true );
		if ( empty( $body['checksums'] ) || ! is_array( $body['checksums'] ) ) {
			return array();
		}

		$checksums  = $body['checksums'];
		$abspath    = untrailingslashit( ABSPATH );
		$modified   = array();

		foreach ( $checksums as $file => $expected_md5 ) {
			if ( time() - $start >= self::SCAN_BUDGET_SEC ) {
				break; // respect time budget
			}

			// Skip wp-content — user files live there
			if ( str_starts_with( $file, 'wp-content/' ) ) {
				continue;
			}

			$full_path = $abspath . '/' . $file;
			if ( ! file_exists( $full_path ) ) {
				continue; // missing files handled by separate hardening tools
			}

			$actual_md5 = md5_file( $full_path );
			if ( $actual_md5 !== false && $actual_md5 !== $expected_md5 ) {
				$modified[] = $file;
			}
		}

		if ( empty( $modified ) ) {
			return array();
		}

		return array(
			array(
				'type'        => 'integrity.core_modified',
				'severity'    => 'critical',
				'occurred_at' => gmdate( 'c' ),
				'data'        => array(
					'count'  => count( $modified ),
					'sample' => $modified[0],
					'files'  => array_slice( $modified, 0, 20 ),
				),
			),
		);
	}

	// ── PHP file scan in uploads ───────────────────────────────────────────────

	private function scan_uploads_php( $start ) {
		$uploads_dir = wp_upload_dir();
		$base        = $uploads_dir['basedir'];

		if ( ! is_dir( $base ) ) {
			return array();
		}

		$php_files = array();
		$this->find_php_files( $base, $php_files, $start );

		if ( empty( $php_files ) ) {
			return array();
		}

		// Make paths relative to uploads dir for reporting
		$relative = array_map(
			function ( $p ) use ( $base ) {
				return str_replace( $base . '/', '', $p );
			},
			$php_files
		);

		return array(
			array(
				'type'        => 'integrity.php_in_uploads',
				'severity'    => 'critical',
				'occurred_at' => gmdate( 'c' ),
				'data'        => array(
					'count'  => count( $php_files ),
					'sample' => $relative[0],
					'files'  => array_slice( $relative, 0, 20 ),
				),
			),
		);
	}

	private function find_php_files( $dir, &$results, $start ) {
		if ( time() - $start >= self::SCAN_BUDGET_SEC ) {
			return;
		}

		$items = @scandir( $dir ); // phpcs:ignore WordPress.PHP.NoSilencedErrors
		if ( ! $items ) {
			return;
		}

		foreach ( $items as $item ) {
			if ( $item === '.' || $item === '..' ) {
				continue;
			}
			if ( time() - $start >= self::SCAN_BUDGET_SEC ) {
				return;
			}

			$path = $dir . '/' . $item;
			if ( is_dir( $path ) ) {
				$this->find_php_files( $path, $results, $start );
			} elseif ( str_ends_with( strtolower( $item ), '.php' ) ) {
				$results[] = $path;
				if ( count( $results ) >= 200 ) {
					return; // cap to avoid memory issues
				}
			}
		}
	}

	// ── WP-Cron registration ───────────────────────────────────────────────────

	public static function schedule() {
		if ( ! wp_next_scheduled( 'sitewatch_integrity_scan' ) ) {
			// Offset by 2h to spread load away from midnight
			wp_schedule_event( time() + 7200, 'daily', 'sitewatch_integrity_scan' );
		}
	}

	public static function unschedule() {
		$ts = wp_next_scheduled( 'sitewatch_integrity_scan' );
		if ( $ts ) {
			wp_unschedule_event( $ts, 'sitewatch_integrity_scan' );
		}
	}
}
