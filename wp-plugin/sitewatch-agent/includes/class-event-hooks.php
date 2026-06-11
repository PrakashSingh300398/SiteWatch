<?php
/**
 * Registers all WordPress action hooks for event capture (spec §3.2).
 *
 * Each hook pushes a structured event into the SiteWatch_Event_Queue.
 * Severities follow the table in spec §3.2; final severity may be overridden
 * server-side based on geo-login context, spike detection, etc.
 */
class SiteWatch_Event_Hooks {

	/** @var SiteWatch_Event_Queue */
	private $queue;

	/** Options that trigger a warning event when changed (spec §3.2). */
	const OPTION_ALLOWLIST = array(
		'siteurl', 'home', 'admin_email', 'users_can_register',
		'default_role', 'permalink_structure', 'blog_public',
	);

	/** Roles whose assignment produces a critical event. */
	const CRITICAL_ROLES = array( 'administrator', 'editor' );

	public function __construct( SiteWatch_Event_Queue $queue ) {
		$this->queue = $queue;
	}

	public function register() {
		// Users
		add_action( 'user_register',      array( $this, 'on_user_register' ),   10, 1 );
		add_action( 'set_user_role',      array( $this, 'on_user_role_change' ), 10, 3 );
		add_action( 'delete_user',        array( $this, 'on_user_delete' ),      10, 1 );
		add_action( 'after_password_reset', array( $this, 'on_password_reset' ), 10, 1 );
		add_action( 'wp_login',           array( $this, 'on_login_success' ),    10, 2 );
		add_action( 'wp_login_failed',    array( $this, 'on_login_failed' ),     10, 1 );

		// Plugins / themes / core updates
		add_action( 'upgrader_process_complete', array( $this, 'on_upgrader_complete' ), 10, 2 );
		add_action( 'activated_plugin',          array( $this, 'on_plugin_activated' ),  10, 1 );
		add_action( 'deactivated_plugin',        array( $this, 'on_plugin_deactivated' ), 10, 1 );
		add_action( 'deleted_plugin',            array( $this, 'on_plugin_deleted' ),    10, 2 );
		add_action( 'switch_theme',              array( $this, 'on_theme_switched' ),    10, 2 );

		// Critical option changes
		add_action( 'updated_option', array( $this, 'on_option_updated' ), 10, 3 );

		// Theme file edits via WP admin editor
		add_action( 'edit_theme_plugin_file', array( $this, 'on_theme_file_edited' ), 10, 1 );

		// Content (info / digest only)
		add_action( 'transition_post_status', array( $this, 'on_post_status_change' ), 10, 3 );
	}

	// ── User hooks ────────────────────────────────────────────────────────────

	public function on_user_register( $user_id ) {
		$user = get_userdata( $user_id );
		if ( ! $user ) {
			return;
		}
		$roles    = (array) $user->roles;
		$is_admin = in_array( 'administrator', $roles, true );

		$this->queue->push(
			'user.created',
			$is_admin ? 'critical' : 'info',
			array(
				'user_login' => $user->user_login,
				'role'       => implode( ',', $roles ),
			)
		);
	}

	public function on_user_role_change( $user_id, $new_role, $old_roles ) {
		$user     = get_userdata( $user_id );
		$severity = in_array( $new_role, self::CRITICAL_ROLES, true ) ? 'critical' : 'warning';

		$this->queue->push(
			'user.role_changed',
			$severity,
			array(
				'user_login' => $user ? $user->user_login : (string) $user_id,
				'old_role'   => implode( ',', (array) $old_roles ),
				'new_role'   => $new_role,
			)
		);
	}

	public function on_user_delete( $user_id ) {
		$user = get_userdata( $user_id );
		$this->queue->push(
			'user.deleted',
			'warning',
			array(
				'user_login' => $user ? $user->user_login : (string) $user_id,
				'user_id'    => $user_id,
			)
		);
	}

	public function on_password_reset( $user ) {
		$this->queue->push(
			'user.password_reset',
			'warning',
			array( 'user_login' => $user->user_login )
		);
	}

	public function on_login_success( $user_login, $user ) {
		$this->queue->push(
			'user.login_success',
			'info',
			array(
				'user_login' => $user_login,
				'is_admin'   => user_can( $user, 'manage_options' ),
				'ip'         => $this->client_ip(),
			)
		);
	}

	public function on_login_failed( $username ) {
		$this->queue->push(
			'user.login_failed',
			'info',
			array(
				'username_attempted' => $username,
				'ip'                 => $this->client_ip(),
			)
		);
	}

	/** Returns the best available client IP, safe for logging (not trusted for access control). */
	private function client_ip() {
		foreach ( array( 'HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'REMOTE_ADDR' ) as $key ) {
			if ( ! empty( $_SERVER[ $key ] ) ) { // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
				return sanitize_text_field( wp_unslash( $_SERVER[ $key ] ) ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput
			}
		}
		return '';
	}

	// ── Plugin / theme / core hooks ───────────────────────────────────────────

	public function on_upgrader_complete( $upgrader, $options ) {
		$type   = isset( $options['type'] ) ? $options['type'] : '';
		$action = isset( $options['action'] ) ? $options['action'] : '';

		if ( 'plugin' === $type ) {
			$is_install = 'install' === $action;
			$event_type = $is_install ? 'plugin.installed' : 'plugin.updated';
			$severity   = $is_install ? 'warning' : 'info';

			$plugin_files = isset( $options['plugins'] )
				? (array) $options['plugins']
				: ( isset( $options['plugin'] ) ? array( $options['plugin'] ) : array() );

			// Resolve human-readable names from plugin file paths
			$plugin_names = array_map( array( $this, 'plugin_name' ), $plugin_files );

			$this->queue->push(
				$event_type,
				$severity,
				array(
					'plugins'      => $plugin_files,
					'plugin_names' => $plugin_names,
					// Convenience: single name for display when only one plugin
					'name'         => count( $plugin_names ) === 1 ? $plugin_names[0] : implode( ', ', $plugin_names ),
				)
			);

		} elseif ( 'theme' === $type ) {
			$event_type  = 'install' === $action ? 'theme.installed' : 'theme.updated';
			$theme_slugs = isset( $options['themes'] ) ? (array) $options['themes'] : array();
			$theme_names = array_map(
				function ( $slug ) {
					$theme = wp_get_theme( $slug );
					return $theme->exists() ? $theme->get( 'Name' ) : $slug;
				},
				$theme_slugs
			);
			$this->queue->push(
				$event_type,
				'info',
				array(
					'themes'      => $theme_slugs,
					'theme_names' => $theme_names,
					'name'        => count( $theme_names ) === 1 ? $theme_names[0] : implode( ', ', $theme_names ),
				)
			);

		} elseif ( 'core' === $type ) {
			$this->queue->push(
				'core.updated',
				'info',
				array( 'version' => get_bloginfo( 'version' ) )
			);
		}
	}

	public function on_plugin_activated( $plugin_file ) {
		$this->queue->push(
			'plugin.activated',
			'warning',
			array(
				'plugin' => $plugin_file,
				'name'   => $this->plugin_name( $plugin_file ),
			)
		);
	}

	public function on_plugin_deactivated( $plugin_file ) {
		$this->queue->push(
			'plugin.deactivated',
			'warning',
			array(
				'plugin' => $plugin_file,
				'name'   => $this->plugin_name( $plugin_file ),
			)
		);
	}

	public function on_plugin_deleted( $plugin_file, $deleted ) {
		if ( ! $deleted ) {
			return;
		}
		$this->queue->push(
			'plugin.deleted',
			'warning',
			array( 'plugin' => $plugin_file )
		);
	}

	public function on_theme_switched( $new_theme, $old_theme ) {
		$this->queue->push(
			'theme.switched',
			'warning',
			array(
				'new_theme' => $new_theme,
				'old_theme' => is_object( $old_theme ) ? $old_theme->get( 'Name' ) : (string) $old_theme,
			)
		);
	}

	public function on_theme_file_edited( $args ) {
		$file  = isset( $args['file'] ) ? $args['file'] : ( is_string( $args ) ? $args : '' );
		$theme = isset( $args['theme'] ) ? $args['theme'] : get_option( 'stylesheet' );
		$user  = wp_get_current_user();

		$this->queue->push(
			'theme.file_edited',
			'warning',
			array(
				'theme'      => $theme,
				'file'       => $file,
				'user_login' => $user ? $user->user_login : '',
			)
		);
	}

	// ── Option hooks ──────────────────────────────────────────────────────────

	public function on_option_updated( $option_name, $old_value, $new_value ) {
		if ( ! in_array( $option_name, self::OPTION_ALLOWLIST, true ) ) {
			return;
		}

		$scalar = function ( $v ) {
			return is_scalar( $v ) ? (string) $v : wp_json_encode( $v );
		};

		$this->queue->push(
			'option.changed',
			'warning',
			array(
				'option'    => $option_name,
				'old_value' => $scalar( $old_value ),
				'new_value' => $scalar( $new_value ),
			)
		);
	}

	// ── Content hooks ─────────────────────────────────────────────────────────

	public function on_post_status_change( $new_status, $old_status, $post ) {
		// Only capture when a post transitions to published
		if ( 'publish' !== $new_status || 'publish' === $old_status ) {
			return;
		}
		if ( ! in_array( $post->post_type, array( 'post', 'page' ), true ) ) {
			return;
		}

		$author = get_userdata( $post->post_author );
		$this->queue->push(
			'content.published',
			'info',
			array(
				'post_id'    => $post->ID,
				'post_type'  => $post->post_type,
				'title'      => $post->post_title,
				'author'     => $author ? $author->user_login : '',
				'edit_url'   => get_edit_post_link( $post->ID, 'raw' ),
			)
		);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private function plugin_name( $plugin_file ) {
		if ( ! function_exists( 'get_plugin_data' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		$full_path = WP_PLUGIN_DIR . '/' . $plugin_file;
		if ( ! file_exists( $full_path ) ) {
			return $plugin_file;
		}
		$data = get_plugin_data( $full_path, false, false );
		return isset( $data['Name'] ) ? $data['Name'] : $plugin_file;
	}
}
