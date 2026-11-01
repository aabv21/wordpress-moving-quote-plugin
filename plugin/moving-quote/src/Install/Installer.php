<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Install;

use Chivabox\MovingQuote\Settings\Defaults;

/**
 * The plugin's install lifecycle: table creation, default settings, the outbox cron schedule,
 * and the version-based upgrade path.
 */
final class Installer {
	public const DB_VERSION    = '1';
	public const CRON_HOOK     = 'moving_quote_process_outbox';
	public const CRON_SCHEDULE = 'moving_quote_every_minute';

	private const DB_VERSION_OPTION = 'moving_quote_db_version';

	/** Runs on plugin activation: creates the table, seeds defaults, and schedules the cron hook. */
	public static function activate(): void {
		self::run_db_delta();
		self::ensure_settings_and_schedule();
		update_option( self::DB_VERSION_OPTION, self::DB_VERSION );
	}

	/** Runs on plugin deactivation: only unschedules the cron hook. The table and options stay. */
	public static function deactivate(): void {
		wp_clear_scheduled_hook( self::CRON_HOOK );
	}

	/**
	 * Runs on every `plugins_loaded`: reruns `dbDelta()` when the stored schema version is stale.
	 * A site that was active before this version shipped, or was upgraded in place without a
	 * re-activation, never ran `activate()`, so this also seeds the settings and the cron
	 * schedule — both idempotent, so this is safe to run alongside an `activate()` that already
	 * ran them.
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
	 * Adds the "Every minute" schedule the outbox cron hook runs on. `wp_get_schedules()` can run
	 * this filter as early as plugin activation, well before `init`, so the display string is
	 * translated only once it's safe to load a text domain; otherwise untranslated English is
	 * fine for a label nothing but the admin's own cron list reads.
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

	/** Seeds the default settings (never overwriting an existing value) and schedules the outbox cron hook (unless it's already scheduled). Both calls are no-ops when already done. */
	private static function ensure_settings_and_schedule(): void {
		add_option( 'moving_quote_settings', Defaults::settings(), '', true );

		if ( false === wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time() + 60, self::CRON_SCHEDULE, self::CRON_HOOK );
		}
	}
}
