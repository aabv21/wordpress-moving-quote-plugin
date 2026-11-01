<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Install;

/**
 * Removes everything the plugin leaves behind: the leads table, its options, its rate-limit
 * transients, and the outbox cron hook.
 */
final class Uninstaller {
	/** Drops the leads table and every option, transient, and cron hook the plugin owns. */
	public static function uninstall(): void {
		global $wpdb;

		$table = $wpdb->prefix . 'moving_quote_leads';
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $table ) );

		delete_option( 'moving_quote_settings' );
		delete_option( 'moving_quote_db_version' );

		self::delete_rate_limit_transients();

		wp_clear_scheduled_hook( Installer::CRON_HOOK );
	}

	private static function delete_rate_limit_transients(): void {
		global $wpdb;

		$like = $wpdb->esc_like( '_transient_moving_quote_rl_' ) . '%';
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE option_name LIKE %s', $wpdb->options, $like ) );

		$timeout_like = $wpdb->esc_like( '_transient_timeout_moving_quote_rl_' ) . '%';
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE option_name LIKE %s', $wpdb->options, $timeout_like ) );
	}
}
