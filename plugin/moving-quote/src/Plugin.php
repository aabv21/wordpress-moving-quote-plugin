<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote;

use Chivabox\MovingQuote\Admin\{LeadsPage, Menu, PersonalData, SettingsPage, StuckDeliveryNotice};
use Chivabox\MovingQuote\Delivery\Outbox;
use Chivabox\MovingQuote\Frontend\{ReferenceShortcode, Shortcode};
use Chivabox\MovingQuote\Install\Installer;
use Chivabox\MovingQuote\Rest\{EstimateController, LeadController};

/**
 * Plugin entry point: wires bootstrap hooks for the main plugin file.
 */
final class Plugin {
	public const VERSION = '1.1.0';

	public static function boot( string $plugin_file ): void {
		add_action(
			'init',
			static function () use ( $plugin_file ): void {
				// dirname( plugin_basename( $plugin_file ) ) is the plugin's own folder name
				// relative to wp-content/plugins, not a hardcoded 'moving-quote', which would
				// silently stop finding translations the moment the folder is ever renamed.
				load_plugin_textdomain( 'moving-quote', false, dirname( plugin_basename( $plugin_file ) ) . '/languages' );
			}
		);

		register_activation_hook( $plugin_file, [ Installer::class, 'activate' ] );
		register_deactivation_hook( $plugin_file, [ Installer::class, 'deactivate' ] );
		add_filter( 'cron_schedules', [ Installer::class, 'add_schedule' ] ); // phpcs:ignore WordPress.WP.CronInterval.ChangeDetected -- the interval is a fixed 60 seconds, defined in Installer::add_schedule().
		add_action( 'plugins_loaded', [ Installer::class, 'maybe_upgrade' ] );
		// A cron-triggered run of the outbox simply discards the delivered count, like any action callback.
		add_action( Installer::CRON_HOOK, [ Outbox::class, 'process_due' ] ); // @phpstan-ignore return.void (process_due() has a meaningful return for its direct callers, not just this hook)

		add_action( 'admin_menu', [ Menu::class, 'register' ] );
		SettingsPage::register();
		LeadsPage::register_hooks();
		StuckDeliveryNotice::register();
		PersonalData::register();
		Shortcode::register();
		ReferenceShortcode::register();

		add_action(
			'rest_api_init',
			static function (): void {
				EstimateController::register();
				LeadController::register();
			}
		);
	}
}
