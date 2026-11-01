<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote;

use Chivabox\MovingQuote\Install\Installer;

/**
 * Plugin entry point: wires bootstrap hooks for the main plugin file.
 */
final class Plugin {
	public const VERSION = '1.0.0';

	public static function boot( string $plugin_file ): void {
		add_action(
			'init',
			static function (): void {
				load_plugin_textdomain( 'moving-quote', false, 'moving-quote/languages' );
			}
		);

		register_activation_hook( $plugin_file, [ Installer::class, 'activate' ] );
		register_deactivation_hook( $plugin_file, [ Installer::class, 'deactivate' ] );
		add_filter( 'cron_schedules', [ Installer::class, 'add_schedule' ] ); // phpcs:ignore WordPress.WP.CronInterval.ChangeDetected -- the interval is a fixed 60 seconds, defined in Installer::add_schedule().
		add_action( 'plugins_loaded', [ Installer::class, 'maybe_upgrade' ] );
	}
}
