<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Settings;

use Chivabox\MovingQuote\Pricing\{DistanceTable, Rates};

/**
 * @phpstan-import-type SettingsShape from Defaults
 */
final class Options {
	public const NAME = 'moving_quote_settings';

	/**
	 * Runs through the form's pure sanitizer over the defaults, so a partial or corrupted option
	 * falls back per field instead of crashing a page load.
	 *
	 * @return SettingsShape
	 */
	public static function all(): array {
		$defaults = Defaults::settings();
		$stored   = get_option( self::NAME );
		if ( ! is_array( $stored ) ) {
			return $defaults;
		}

		/** @var array<string, mixed> $stored the option is always saved as an associative array */
		return SettingsSanitizer::sanitize( $stored, $defaults )->settings;
	}

	public static function rates(): Rates {
		return Rates::from_settings( self::all() );
	}

	public static function distances(): DistanceTable {
		return DistanceTable::from_settings( self::all() );
	}

	public static function webhook_url(): string {
		return self::all()['webhook_url'];
	}

	public static function webhook_secret(): string {
		return self::all()['webhook_secret'];
	}

	public static function team_email(): string {
		return self::all()['team_email'];
	}

	public static function delivery_enabled(): bool {
		$settings = self::all();
		return '' !== $settings['webhook_url'] && '' !== $settings['webhook_secret'] && '' !== $settings['team_email'];
	}
}
