<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Install;

use Chivabox\MovingQuote\Settings\Defaults;

final class Installer {
	/** Bumped on every schema change: '2' added the `locale` column. */
	public const DB_VERSION    = '2';
	public const CRON_HOOK     = 'moving_quote_process_outbox';
	public const CRON_SCHEDULE = 'moving_quote_every_minute';

	private const DB_VERSION_OPTION = 'moving_quote_db_version';

	/**
	 * Refuses on any Multisite install, checked with `is_multisite()`: `$network_wide` is false for
	 * a per-site activation there too. Multisite is unverified, and would give every site admin an
	 * SSRF read-back through `last_error` by aiming the webhook at an internal address.
	 */
	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- register_activation_hook() always passes $network_wide; the refusal checks is_multisite() instead.
	public static function activate( bool $network_wide = false ): void {
		if ( is_multisite() ) {
			wp_die(
				esc_html__( "Chivabox moving quotes doesn't support Multisite.", 'moving-quote' ),
				esc_html__( 'Plugin activation error', 'moving-quote' ),
				[ 'back_link' => true ]
			);
		}

		self::run_db_delta();
		self::ensure_settings_and_schedule();
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/** The table and options stay. */
	public static function deactivate(): void {
		wp_clear_scheduled_hook( self::CRON_HOOK );
	}

	/**
	 * Also seeds settings and the cron schedule (both idempotent): a site upgraded in place never
	 * ran `activate()`.
	 */
	public static function maybe_upgrade(): void {
		if ( self::DB_VERSION === get_option( self::DB_VERSION_OPTION ) ) {
			return;
		}

		self::run_db_delta();
		self::ensure_settings_and_schedule();
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/**
	 * This filter can run before `init`, so the label is translated only once that's safe;
	 * otherwise English is fine for a label only cron lists show.
	 *
	 * @param array<string, array{interval: int, display: string}> $schedules
	 * @return array<string, array{interval: int, display: string}>
	 */
	public static function add_schedule( array $schedules ): array {
		$schedules[ self::CRON_SCHEDULE ] = [
			'interval' => 60,
			'display'  => did_action( 'init' ) ? __( 'Every minute', 'moving-quote' ) : 'Every minute',
		];
		return $schedules;
	}

	private static function run_db_delta(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table = $wpdb->prefix . 'moving_quote_leads';
		dbDelta( Schema::sql( $table, $wpdb->get_charset_collate() ) );
	}

	/** Both steps are no-ops when already done; an existing setting is never overwritten. */
	private static function ensure_settings_and_schedule(): void {
		add_option( 'moving_quote_settings', Defaults::settings(), '', true );

		if ( false === wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, self::CRON_SCHEDULE, self::CRON_HOOK );
		}
	}
}
