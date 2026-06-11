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
	 * Each entry: { plugin, form_id, form_name, count_24h, count_7d, last_entry_at }
	 */
	private function form_counts() {
		global $wpdb;
		$forms     = array();
		$since_24h = gmdate( 'Y-m-d H:i:s', time() - DAY_IN_SECONDS );
		$since_7d  = gmdate( 'Y-m-d H:i:s', time() - 7 * DAY_IN_SECONDS );

		// ── Gravity Forms ──────────────────────────────────────────────────────
		if ( class_exists( 'GFAPI' ) ) {
			foreach ( GFAPI::get_forms() as $form ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$count_24h = (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT COUNT(*) FROM {$wpdb->prefix}gf_entry WHERE form_id=%d AND date_created>=%s AND status='active'",
						$form['id'], $since_24h
					)
				);
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$count_7d = (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT COUNT(*) FROM {$wpdb->prefix}gf_entry WHERE form_id=%d AND date_created>=%s AND status='active'",
						$form['id'], $since_7d
					)
				);
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$last_entry = $wpdb->get_var(
					$wpdb->prepare(
						"SELECT MAX(date_created) FROM {$wpdb->prefix}gf_entry WHERE form_id=%d AND status='active'",
						$form['id']
					)
				);
				$forms[] = array(
					'plugin'        => 'gravityforms',
					'form_id'       => (string) $form['id'],
					'form_name'     => $form['title'],
					'count_24h'     => $count_24h,
					'count_7d'      => $count_7d,
					'last_entry_at' => $last_entry ? gmdate( 'c', strtotime( $last_entry ) ) : null,
				);
			}
		}

		// ── WPForms (Lite + Pro) ──────────────────────────────────────────────
		// Use get_posts on the 'wpforms' CPT — works on both Lite and Pro without
		// relying on the wpforms() helper which has API changes between versions.
		if ( post_type_exists( 'wpforms' ) ) {
			$wpf_posts = get_posts(
				array(
					'post_type'      => 'wpforms',
					'post_status'    => 'publish',
					'posts_per_page' => 50,
					'fields'         => 'all',
				)
			);

			// Entries table only exists in WPForms Pro
			$entry_table  = $wpdb->prefix . 'wpforms_entries';
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery
			$table_exists = (bool) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $entry_table ) );

			foreach ( $wpf_posts as $wpf_post ) {
				$form_id   = $wpf_post->ID;
				$form_name = $wpf_post->post_title;
				$count_24h = null;
				$count_7d  = null;
				$last_entry_at = null;

				if ( $table_exists ) {
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery
					$count_24h = (int) $wpdb->get_var(
						$wpdb->prepare(
							"SELECT COUNT(*) FROM {$entry_table} WHERE form_id=%d AND `date`>=%s",
							$form_id, $since_24h
						)
					);
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery
					$count_7d = (int) $wpdb->get_var(
						$wpdb->prepare(
							"SELECT COUNT(*) FROM {$entry_table} WHERE form_id=%d AND `date`>=%s",
							$form_id, $since_7d
						)
					);
					// phpcs:ignore WordPress.DB.DirectDatabaseQuery
					$last_raw = $wpdb->get_var(
						$wpdb->prepare(
							"SELECT MAX(`date`) FROM {$entry_table} WHERE form_id=%d",
							$form_id
						)
					);
					$last_entry_at = $last_raw ? gmdate( 'c', strtotime( $last_raw ) ) : null;
				}

				$forms[] = array(
					'plugin'        => 'wpforms',
					'form_id'       => (string) $form_id,
					'form_name'     => $form_name,
					'count_24h'     => $count_24h,
					'count_7d'      => $count_7d,
					'last_entry_at' => $last_entry_at,
				);
			}
		}

		// ── Contact Form 7 + Flamingo ──────────────────────────────────────────
		if ( class_exists( 'WPCF7' ) && post_type_exists( 'flamingo-inbound' ) ) {
			$cf7_forms = WPCF7_ContactForm::find();
			foreach ( $cf7_forms as $cf7form ) {
				$channel   = 'contact-form-7.' . $cf7form->id();
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$count_24h = (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT COUNT(*) FROM {$wpdb->posts} p
						 INNER JOIN {$wpdb->postmeta} m ON p.ID=m.post_id
						 WHERE p.post_type='flamingo-inbound'
						   AND m.meta_key='_channel' AND m.meta_value=%s
						   AND p.post_date_gmt>=%s",
						$channel, $since_24h
					)
				);
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$count_7d = (int) $wpdb->get_var(
					$wpdb->prepare(
						"SELECT COUNT(*) FROM {$wpdb->posts} p
						 INNER JOIN {$wpdb->postmeta} m ON p.ID=m.post_id
						 WHERE p.post_type='flamingo-inbound'
						   AND m.meta_key='_channel' AND m.meta_value=%s
						   AND p.post_date_gmt>=%s",
						$channel, $since_7d
					)
				);
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery
				$last_raw = $wpdb->get_var(
					$wpdb->prepare(
						"SELECT MAX(p.post_date_gmt) FROM {$wpdb->posts} p
						 INNER JOIN {$wpdb->postmeta} m ON p.ID=m.post_id
						 WHERE p.post_type='flamingo-inbound'
						   AND m.meta_key='_channel' AND m.meta_value=%s",
						$channel
					)
				);
				$forms[] = array(
					'plugin'        => 'cf7',
					'form_id'       => (string) $cf7form->id(),
					'form_name'     => $cf7form->title(),
					'count_24h'     => $count_24h,
					'count_7d'      => $count_7d,
					'last_entry_at' => $last_raw ? gmdate( 'c', strtotime( $last_raw ) ) : null,
				);
			}
		}

		return $forms;
	}
}
