<?php
/**
 * Builds the full health snapshot returned by GET /wp-json/sitewatch/v1/health (spec §3.3).
 */
class SiteWatch_Health {

	public function snapshot() {
		return array(
			'wp_version'         => get_bloginfo( 'version' ),
			'wp_update_available'=> $this->core_update_available(),
			'php_version'        => PHP_VERSION,
			'mysql_version'      => $this->mysql_version(),
			'memory_limit'       => WP_MEMORY_LIMIT,
			'plugins'            => $this->plugins(),
			'themes'             => $this->themes(),
			'administrators'     => $this->administrators(),
			'security'           => $this->security_checklist(),
			'forms'              => $this->form_counts(),
		);
	}

	// ─────────────────────────────────────────────────────────────────────────

	private function core_update_available() {
		$updates = get_site_transient( 'update_core' );
		if ( empty( $updates->updates ) ) {
			return null;
		}
		foreach ( $updates->updates as $u ) {
			if ( 'upgrade' === $u->response ) {
				return $u->version;
			}
		}
		return null;
	}

	private function mysql_version() {
		global $wpdb;
		return $wpdb->get_var( 'SELECT VERSION()' ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery
	}

	private function plugins() {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}

		$all_plugins    = get_plugins();
		$active_plugins = (array) get_option( 'active_plugins', array() );
		$updates        = get_site_transient( 'update_plugins' );
		$result         = array();

		foreach ( $all_plugins as $file => $data ) {
			$has_update  = ! empty( $updates->response[ $file ] );
			$result[] = array(
				'slug'            => ( '.' === dirname( $file ) ) ? basename( $file, '.php' ) : dirname( $file ),
				'name'            => $data['Name'],
				'version'         => $data['Version'],
				'active'          => in_array( $file, $active_plugins, true ),
				'update_available'=> $has_update,
				'new_version'     => $has_update ? $updates->response[ $file ]->new_version : null,
			);
		}

		return $result;
	}

	private function themes() {
		$all_themes = wp_get_themes();
		$updates    = get_site_transient( 'update_themes' );
		$active     = get_option( 'stylesheet' );
		$result     = array();

		foreach ( $all_themes as $slug => $theme ) {
			$has_update = ! empty( $updates->response[ $slug ] );
			$result[] = array(
				'slug'            => $slug,
				'name'            => $theme->get( 'Name' ),
				'version'         => $theme->get( 'Version' ),
				'active'          => $slug === $active,
				'update_available'=> $has_update,
				'new_version'     => $has_update ? $updates->response[ $slug ]['new_version'] : null,
			);
		}

		return $result;
	}

	private function administrators() {
		$users = get_users( array( 'role' => 'administrator' ) );
		return array_map(
			function ( $u ) {
				return array( 'user_login' => $u->user_login );
			},
			$users
		);
	}

	private function security_checklist() {
		return array(
			'disallow_file_edit'     => defined( 'DISALLOW_FILE_EDIT' ) && DISALLOW_FILE_EDIT,
			'wp_debug_on'            => defined( 'WP_DEBUG' ) && WP_DEBUG,
			'default_admin_exists'   => (bool) get_user_by( 'login', 'admin' ),
			'xmlrpc_enabled'         => ! has_filter( 'xmlrpc_enabled', '__return_false' ),
			'user_registration_open' => (bool) get_option( 'users_can_register' ),
			'default_role'           => (string) get_option( 'default_role', 'subscriber' ),
		);
	}

	/**
	 * Returns submission counts for detected form plugins (spec §3.3).
	 * Degrades gracefully when plugins are absent.
	 */
	private function form_counts() {
		global $wpdb;
		$forms = array();

		// ── Gravity Forms ──────────────────────────────────────────────────────
		if ( class_exists( 'GFAPI' ) ) {
			foreach ( GFAPI::get_forms() as $form ) {
				$since = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS );
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$count_24h = (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT COUNT(*) FROM {$wpdb->prefix}gf_entry WHERE form_id = %d AND date_created >= %s AND status = 'active'",
						$form['id'],
						$since
					)
				);
				$forms[] = array(
					'plugin'    => 'gravityforms',
					'form_id'   => (string) $form['id'],
					'form_name' => $form['title'],
					'count_24h' => $count_24h,
				);
			}
		}

		// ── WPForms ────────────────────────────────────────────────────────────
		if ( function_exists( 'wpforms' ) && class_exists( '\WPForms\Pro\Forms\Entry' ) ) {
			// Entries table exists only in Pro; degrade gracefully
			$forms_list = wpforms()->get( 'form' )->get( '', array( 'fields' => 'ids' ) );
			foreach ( (array) $forms_list as $form_id ) {
				$form_obj  = wpforms()->get( 'form' )->get( $form_id );
				$form_name = isset( $form_obj->post_title ) ? $form_obj->post_title : (string) $form_id;
				$forms[]   = array(
					'plugin'    => 'wpforms',
					'form_id'   => (string) $form_id,
					'form_name' => $form_name,
					'count_24h' => null, // requires Pro; set to null rather than 0
				);
			}
		}

		return $forms;
	}
}
