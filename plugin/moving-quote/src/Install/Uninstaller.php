<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Install;

use Chivabox\MovingQuote\Security\RateLimiter;

final class Uninstaller {
	public static function uninstall(): void {
		global $wpdb;

		$table = $wpdb->prefix . 'moving_quote_leads';
		$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $table ) );

		delete_option( 'moving_quote_settings' );
		delete_option( 'moving_quote_db_version' );

		self::delete_rate_limit_transients();
		delete_transient( RateLimiter::RATE_LIMITED_COUNT_TRANSIENT );

		wp_clear_scheduled_hook( Installer::CRON_HOOK );
	}

	/** The per-IP buckets (`moving_quote_rl_*`); the rate-limited counter is deleted above through `delete_transient()`. */
	private static function delete_rate_limit_transients(): void {
		global $wpdb;

		$like = $wpdb->esc_like( '_transient_moving_quote_rl_' ) . '%';
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE option_name LIKE %s', $wpdb->options, $like ) );

		$timeout_like = $wpdb->esc_like( '_transient_timeout_moving_quote_rl_' ) . '%';
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE option_name LIKE %s', $wpdb->options, $timeout_like ) );
	}
}
