<?php
/**
 * Settings page HTML template.
 * All dynamic output is escaped. No inline JS; pure HTML form.
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$site_id     = get_option( 'sitewatch_site_id', '' );
$backend_url = get_option( 'sitewatch_backend_url', '' );
$paired_at   = get_option( 'sitewatch_paired_at', '' );
$last_sync   = get_option( 'sitewatch_last_sync', '' );
$site_key    = (string) get_option( 'sitewatch_site_key', '' );
$is_paired   = ! empty( $site_id );

// Notice flags from redirect
$saved        = isset( $_GET['saved'] ) && '1' === $_GET['saved']; // phpcs:ignore WordPress.Security.NonceVerification
$paired_ok    = isset( $_GET['paired'] ) && '1' === $_GET['paired']; // phpcs:ignore WordPress.Security.NonceVerification
$disconnected = isset( $_GET['disconnected'] ) && '1' === $_GET['disconnected']; // phpcs:ignore WordPress.Security.NonceVerification
$error        = isset( $_GET['sw_error'] ) ? sanitize_text_field( wp_unslash( $_GET['sw_error'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification
?>
<div class="wrap">
	<h1><?php esc_html_e( 'SiteWatch Agent', 'sitewatch-agent' ); ?></h1>
	<p><?php esc_html_e( 'Monitoring agent for the SiteWatch platform.', 'sitewatch-agent' ); ?></p>

	<?php if ( $saved ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Settings saved.', 'sitewatch-agent' ); ?></p></div>
	<?php endif; ?>
	<?php if ( $paired_ok ) : ?>
		<div class="notice notice-success is-dismissible"><p><?php esc_html_e( 'Site paired successfully! This site is now sending data to SiteWatch.', 'sitewatch-agent' ); ?></p></div>
	<?php endif; ?>
	<?php if ( $disconnected ) : ?>
		<div class="notice notice-info is-dismissible"><p><?php esc_html_e( 'Disconnected from SiteWatch. Your site key is preserved — re-pair with a new code to reconnect.', 'sitewatch-agent' ); ?></p></div>
	<?php endif; ?>
	<?php if ( $error ) : ?>
		<div class="notice notice-error is-dismissible">
			<p>
				<?php esc_html_e( 'Error:', 'sitewatch-agent' ); ?>
				<strong><?php echo esc_html( $error ); ?></strong>
			</p>
		</div>
	<?php endif; ?>

	<?php /* ── Connection status card ── */ ?>
	<table class="form-table" role="presentation">
		<tr>
			<th scope="row"><?php esc_html_e( 'Status', 'sitewatch-agent' ); ?></th>
			<td>
				<?php if ( $is_paired ) : ?>
					<span style="color:#00a32a;font-weight:bold;">&#10003; <?php esc_html_e( 'Connected', 'sitewatch-agent' ); ?></span>
					&nbsp;&mdash;&nbsp; Site ID: <code><?php echo esc_html( $site_id ); ?></code>
				<?php else : ?>
					<span style="color:#d63638;font-weight:bold;">&#10007; <?php esc_html_e( 'Not connected', 'sitewatch-agent' ); ?></span>
				<?php endif; ?>
			</td>
		</tr>
		<?php if ( $is_paired ) : ?>
		<tr>
			<th scope="row"><?php esc_html_e( 'Paired at', 'sitewatch-agent' ); ?></th>
			<td><?php echo esc_html( $paired_at ?: '—' ); ?></td>
		</tr>
		<tr>
			<th scope="row"><?php esc_html_e( 'Last sync', 'sitewatch-agent' ); ?></th>
			<td><?php echo esc_html( $last_sync ?: '—' ); ?></td>
		</tr>
		<?php endif; ?>
		<tr>
			<th scope="row"><?php esc_html_e( 'Site key', 'sitewatch-agent' ); ?></th>
			<td>
				<code><?php echo esc_html( substr( $site_key, 0, 8 ) . '…' ); ?></code>
				<span class="description"><?php esc_html_e( '(truncated — full key lives only on this server)', 'sitewatch-agent' ); ?></span>
			</td>
		</tr>
	</table>

	<hr/>

	<?php /* ── Backend URL ── */ ?>
	<h2><?php esc_html_e( 'Backend Settings', 'sitewatch-agent' ); ?></h2>
	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<?php wp_nonce_field( 'sitewatch_save' ); ?>
		<input type="hidden" name="action" value="sitewatch_save" />
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">
					<label for="sitewatch_backend_url"><?php esc_html_e( 'Backend URL', 'sitewatch-agent' ); ?></label>
				</th>
				<td>
					<input type="url"
						id="sitewatch_backend_url"
						name="sitewatch_backend_url"
						value="<?php echo esc_attr( $backend_url ); ?>"
						class="regular-text"
						placeholder="https://api.sitewatch.example"
					/>
					<p class="description"><?php esc_html_e( 'Base URL of your SiteWatch API server (no trailing slash).', 'sitewatch-agent' ); ?></p>
				</td>
			</tr>
		</table>
		<?php submit_button( esc_html__( 'Save', 'sitewatch-agent' ) ); ?>
	</form>

	<hr/>

	<?php if ( ! $is_paired ) : ?>
	<?php /* ── Pairing form ── */ ?>
	<h2><?php esc_html_e( 'Connect to SiteWatch', 'sitewatch-agent' ); ?></h2>
	<p><?php esc_html_e( 'In the SiteWatch mobile app, go to Settings → Add Site to get a 6-character pairing code. Enter it below.', 'sitewatch-agent' ); ?></p>
	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<?php wp_nonce_field( 'sitewatch_pair' ); ?>
		<input type="hidden" name="action" value="sitewatch_pair" />
		<table class="form-table" role="presentation">
			<tr>
				<th scope="row">
					<label for="sitewatch_pairing_code"><?php esc_html_e( 'Pairing Code', 'sitewatch-agent' ); ?></label>
				</th>
				<td>
					<input type="text"
						id="sitewatch_pairing_code"
						name="sitewatch_pairing_code"
						value=""
						class="regular-text"
						maxlength="6"
						style="text-transform:uppercase;letter-spacing:4px;font-size:1.3em;width:8em;"
						placeholder="AB3X7K"
						autocomplete="off"
					/>
					<p class="description"><?php esc_html_e( 'The 6-character code expires after 15 minutes.', 'sitewatch-agent' ); ?></p>
				</td>
			</tr>
		</table>
		<?php submit_button( esc_html__( 'Connect', 'sitewatch-agent' ), 'primary' ); ?>
	</form>
	<?php else : ?>
	<?php /* ── Disconnect form ── */ ?>
	<h2><?php esc_html_e( 'Disconnect', 'sitewatch-agent' ); ?></h2>
	<p><?php esc_html_e( 'This removes the pairing from this server only. The site entry on the backend is preserved. To fully remove, delete the site from the SiteWatch app.', 'sitewatch-agent' ); ?></p>
	<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
		<?php wp_nonce_field( 'sitewatch_disconnect' ); ?>
		<input type="hidden" name="action" value="sitewatch_disconnect" />
		<?php submit_button( esc_html__( 'Disconnect this site', 'sitewatch-agent' ), 'delete', 'submit', true, array( 'onclick' => 'return confirm("Disconnect this site from SiteWatch?")' ) ); ?>
	</form>
	<?php endif; ?>
</div>
