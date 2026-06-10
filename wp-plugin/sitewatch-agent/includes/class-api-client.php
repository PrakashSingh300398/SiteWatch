<?php
/**
 * Signs and dispatches outbound HTTP requests to the SiteWatch backend.
 *
 * HMAC-SHA256 scheme (matches backend hmac.ts):
 *   message   = "{timestamp_ms}.{raw_body}"
 *   signature = "sha256=" . hash_hmac( 'sha256', message, site_key )
 * Headers: X-SiteWatch-Signature, X-SiteWatch-Timestamp, X-SiteWatch-Site-Id
 */
class SiteWatch_API_Client {

	/** @var string */
	private $backend_url;

	/** @var string */
	private $site_key;

	/** @var string */
	private $site_id;

	public function __construct() {
		$this->backend_url = rtrim( (string) get_option( 'sitewatch_backend_url', '' ), '/' );
		$this->site_key    = (string) get_option( 'sitewatch_site_key', '' );
		$this->site_id     = (string) get_option( 'sitewatch_site_id', '' );
	}

	// ── Pairing (no HMAC — happens before pairing is complete) ───────────────

	/**
	 * @param string $pairing_code 6-char code from the app.
	 * @return array{ ok: bool, siteId?: string, error?: string }
	 */
	public function pair( $pairing_code ) {
		if ( empty( $this->backend_url ) ) {
			return array( 'ok' => false, 'error' => 'Backend URL not configured' );
		}

		$body = wp_json_encode(
			array(
				'pairingCode' => $pairing_code,
				'siteUrl'     => get_bloginfo( 'url' ),
				'siteKey'     => $this->site_key,
			)
		);

		$response = wp_remote_post(
			$this->backend_url . '/v1/sites/pair',
			array(
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => $body,
				'timeout' => 15,
			)
		);

		if ( is_wp_error( $response ) ) {
			return array( 'ok' => false, 'error' => $response->get_error_message() );
		}

		$code = wp_remote_retrieve_response_code( $response );
		$data = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( 200 === $code && ! empty( $data['ok'] ) ) {
			return array( 'ok' => true, 'siteId' => $data['siteId'] );
		}

		return array( 'ok' => false, 'error' => $data['error'] ?? 'Unexpected response: HTTP ' . $code );
	}

	// ── Events (HMAC-signed) ─────────────────────────────────────────────────

	/**
	 * @param array $events Array of event payloads.
	 * @return bool True on HTTP 2xx.
	 */
	public function post_events( array $events ) {
		if ( empty( $this->site_id ) || empty( $this->site_key ) || empty( $this->backend_url ) ) {
			return false;
		}

		$body = wp_json_encode(
			array(
				'site_id' => $this->site_id,
				'events'  => $events,
			)
		);

		$response = wp_remote_post(
			$this->backend_url . '/v1/events',
			array(
				'headers' => $this->signed_headers( $body ),
				'body'    => $body,
				'timeout' => 10,
			)
		);

		if ( is_wp_error( $response ) ) {
			return false;
		}

		$code = wp_remote_retrieve_response_code( $response );
		return $code >= 200 && $code < 300;
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	/** Build HMAC-signed headers for a request body string. */
	private function signed_headers( $body ) {
		$ts        = (string) intval( microtime( true ) * 1000 );
		$message   = $ts . '.' . $body;
		$signature = 'sha256=' . hash_hmac( 'sha256', $message, $this->site_key );

		return array(
			'Content-Type'            => 'application/json',
			'X-SiteWatch-Signature'   => $signature,
			'X-SiteWatch-Timestamp'   => $ts,
			'X-SiteWatch-Site-Id'     => $this->site_id,
		);
	}
}
