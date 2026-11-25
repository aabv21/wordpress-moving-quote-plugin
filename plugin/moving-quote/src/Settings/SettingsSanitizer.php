<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Settings;

use Chivabox\MovingQuote\Leads\{EmailRule, LeadValidator};

/**
 * Pure. A field that fails validation keeps its current value and reports a stable error code.
 *
 * @phpstan-import-type SettingsShape from Defaults
 * @phpstan-import-type RouteSetting from Defaults
 */
final class SettingsSanitizer {
	private const AMOUNT_MIN     = 0;
	private const AMOUNT_MAX     = 100_000_000;
	private const PERCENT_MIN    = 0;
	private const PERCENT_MAX    = 50;
	private const KM_MIN         = 1;
	private const KM_MAX         = 3_000;
	private const CITY_MIN_LEN   = 2;
	private const CITY_MAX_LEN   = 60;
	private const SECRET_MIN_LEN = 32;

	/** The longest each free-text business field may be, in characters. */
	public const BUSINESS_TEXT_MAX_LEN = [
		'business_street' => 120,
		'business_city'   => 60,
		'business_tax_id' => 40,
	];

	/** As the lead's own phone. */
	private const PHONE_PATTERN = '/^\d{' . LeadValidator::PHONE_MIN_LEN . ',' . LeadValidator::PHONE_MAX_LEN . '}$/';

	/** `HH:MM`, 00:00 to 23:59. */
	private const HOURS_PATTERN = '/^([01]\d|2[0-3]):[0-5]\d$/';

	/** The same set `LeadValidator` rejects in a name: C0, DEL, NEL, and the Unicode line breaks. */
	private const CONTROL_CHARACTER_PATTERN = '/[\x{0000}-\x{001F}\x{007F}\x{0085}\x{2028}\x{2029}]/u';

	/**
	 * @param array<string, mixed> $input   the posted form, or the sanitizer's own output fed back
	 * @param SettingsShape        $current the settings to fall back to on a per-field error
	 */
	public static function sanitize( array $input, array $current ): SanitizedSettings {
		$errors   = [];
		$defaults = Defaults::settings();

		[ $base_rates, $base_rate_errors ] = self::sanitize_amounts( is_array( $input['base_rates'] ?? null ) ? $input['base_rates'] : [], $current['base_rates'], array_keys( $defaults['base_rates'] ) );
		foreach ( $base_rate_errors as $key => $code ) {
			$errors[ "base_rates.{$key}" ] = $code;
		}

		[ $per_room, $per_room_error ] = self::sanitize_amount( $input['per_room'] ?? null, $current['per_room'] );
		if ( null !== $per_room_error ) {
			$errors['per_room'] = $per_room_error;
		}

		[ $per_km, $per_km_error ] = self::sanitize_amount( $input['per_km'] ?? null, $current['per_km'] );
		if ( null !== $per_km_error ) {
			$errors['per_km'] = $per_km_error;
		}

		[ $extras, $extras_errors ] = self::sanitize_amounts( is_array( $input['extras'] ?? null ) ? $input['extras'] : [], $current['extras'], array_keys( $defaults['extras'] ) );
		foreach ( $extras_errors as $key => $code ) {
			$errors[ "extras.{$key}" ] = $code;
		}

		[ $range_percent, $range_error ] = self::sanitize_percent( $input['range_percent'] ?? null, $current['range_percent'] );
		if ( null !== $range_error ) {
			$errors['range_percent'] = $range_error;
		}

		[ $routes, $route_errors ] = self::sanitize_routes( $input['routes'] ?? null, $current['routes'] );
		foreach ( $route_errors as $key => $code ) {
			$errors[ $key ] = $code;
		}

		[ $webhook_url, $url_error ] = self::sanitize_webhook_url( $input['webhook_url'] ?? null, $current['webhook_url'] );
		if ( null !== $url_error ) {
			$errors['webhook_url'] = $url_error;
		}

		[ $webhook_secret, $secret_error ] = self::sanitize_secret( $input['webhook_secret'] ?? null, $current['webhook_secret'] );
		if ( null !== $secret_error ) {
			$errors['webhook_secret'] = $secret_error;
		}

		[ $team_email, $email_error ] = self::sanitize_email( $input['team_email'] ?? null, $current['team_email'] );
		if ( null !== $email_error ) {
			$errors['team_email'] = $email_error;
		}

		$business = [];
		foreach ( [ 'business_phone', 'business_whatsapp' ] as $key ) {
			[ $business[ $key ], $error ] = self::sanitize_phone( $input[ $key ] ?? null, $current[ $key ] );
			if ( null !== $error ) {
				$errors[ $key ] = $error;
			}
		}
		foreach ( self::BUSINESS_TEXT_MAX_LEN as $key => $max_length ) {
			[ $business[ $key ], $error ] = self::sanitize_business_text( $input[ $key ] ?? null, $current[ $key ], $max_length );
			if ( null !== $error ) {
				$errors[ $key ] = $error;
			}
		}
		[ $hours_open, $hours_close, $hours_error ] = self::sanitize_hours( $input['business_hours_open'] ?? null, $input['business_hours_close'] ?? null, $current );
		if ( null !== $hours_error ) {
			$errors['business_hours'] = $hours_error;
		}

		$settings = [
			'base_rates'           => $base_rates,
			'per_room'             => $per_room,
			'per_km'               => $per_km,
			'extras'               => $extras,
			'range_percent'        => $range_percent,
			'routes'               => $routes,
			'webhook_url'          => $webhook_url,
			'webhook_secret'       => $webhook_secret,
			'team_email'           => $team_email,
			'business_phone'       => $business['business_phone'],
			'business_whatsapp'    => $business['business_whatsapp'],
			'business_street'      => $business['business_street'],
			'business_city'        => $business['business_city'],
			'business_hours_open'  => $hours_open,
			'business_hours_close' => $hours_close,
			'business_tax_id'      => $business['business_tax_id'],
		];

		return new SanitizedSettings( $settings, $errors );
	}

	/**
	 * One amount per key, each keeping its current value when the posted one is not an amount.
	 *
	 * @template T of array<string, int>
	 * @param array<array-key, mixed> $input
	 * @param T                       $current
	 * @param list<string>            $keys    every key `Defaults` names for this group
	 * @return array{T, array<string, string>}
	 */
	private static function sanitize_amounts( array $input, array $current, array $keys ): array {
		$amounts = [];
		$errors  = [];

		foreach ( $keys as $key ) {
			[ $amounts[ $key ], $error ] = self::sanitize_amount( $input[ $key ] ?? null, $current[ $key ] );
			if ( null !== $error ) {
				$errors[ $key ] = $error;
			}
		}

		// The loop fills every key `Defaults` names, which is what T's shape holds.
		return [ $amounts, $errors ]; // @phpstan-ignore return.type
	}

	/** @return array{int, string|null} */
	private static function sanitize_amount( mixed $input, int $current ): array {
		$digits = self::amount_digits( $input );
		if ( null === $digits ) {
			return [ $current, 'invalid_amount' ];
		}

		$amount = (int) $digits;
		if ( $amount < self::AMOUNT_MIN || $amount > self::AMOUNT_MAX ) {
			return [ $current, 'invalid_amount' ];
		}

		return [ $amount, null ];
	}

	/** Strips Colombian-style thousands separators (`.`, `,`, space); null when the shape doesn't match. */
	private static function amount_digits( mixed $input ): ?string {
		if ( ! is_string( $input ) && ! is_int( $input ) ) {
			return null;
		}
		$text = (string) $input;
		if ( 1 !== preg_match( '/^\d{1,3}([.,\s]?\d{3})*$/', $text ) ) {
			return null;
		}
		return (string) preg_replace( '/[.,\s]/', '', $text );
	}

	/** @return array{int, string|null} */
	private static function sanitize_percent( mixed $input, int $current ): array {
		if ( ! is_string( $input ) && ! is_int( $input ) ) {
			return [ $current, 'invalid_percent' ];
		}
		$text = (string) $input;
		if ( 1 !== preg_match( '/^\d+$/', $text ) ) {
			return [ $current, 'invalid_percent' ];
		}

		$percent = (int) $text;
		if ( $percent < self::PERCENT_MIN || $percent > self::PERCENT_MAX ) {
			return [ $current, 'invalid_percent' ];
		}

		return [ $percent, null ];
	}

	/**
	 * @param list<RouteSetting> $current
	 * @return array{list<RouteSetting>, array<string, string>}
	 */
	private static function sanitize_routes( mixed $input, array $current ): array {
		if ( ! is_array( $input ) ) {
			return [ $current, [ 'routes' => 'no_routes' ] ];
		}

		$rows   = [];
		$errors = [];
		/** @var array<string, true> $seen_pairs case-insensitive, direction-independent city pairs already accepted */
		$seen_pairs = [];

		foreach ( array_values( $input ) as $index => $row ) {
			$key = 'routes.' . ( $index + 1 );

			[ $route, $error ] = self::sanitize_route_row( $row );
			if ( null !== $error ) {
				$errors[ $key ] = $error;
				continue;
			}
			if ( null === $route ) {
				continue;
			}

			$pair_key = self::pair_key( $route['from'], $route['to'] );
			if ( isset( $seen_pairs[ $pair_key ] ) ) {
				$errors[ $key ] = 'duplicate_route';
				continue;
			}
			$seen_pairs[ $pair_key ] = true;

			$rows[] = $route;
		}

		if ( [] === $errors && [] === $rows ) {
			$errors['routes'] = 'no_routes';
		}

		if ( [] !== $errors ) {
			return [ $current, $errors ];
		}

		return [ $rows, $errors ];
	}

	/**
	 * Null route and null error for a blank or removed row, which is skipped without a message.
	 *
	 * @return array{0: RouteSetting|null, 1: string|null}
	 */
	private static function sanitize_route_row( mixed $row ): array {
		if ( ! is_array( $row ) ) {
			return [ null, null ];
		}

		$from = is_string( $row['from'] ?? null ) ? trim( $row['from'] ) : '';
		$to   = is_string( $row['to'] ?? null ) ? trim( $row['to'] ) : '';
		$km   = $row['km'] ?? null;

		if ( '' === $from && '' === $to ) {
			return [ null, null ];
		}

		if ( ! empty( $row['remove'] ) ) {
			return [ null, null ];
		}

		if ( mb_strlen( $from ) < self::CITY_MIN_LEN || mb_strlen( $from ) > self::CITY_MAX_LEN
			|| mb_strlen( $to ) < self::CITY_MIN_LEN || mb_strlen( $to ) > self::CITY_MAX_LEN
		) {
			return [ null, 'invalid_city' ];
		}

		if ( 0 === strcasecmp( $from, $to ) ) {
			return [ null, 'same_city' ];
		}

		if ( ( ! is_string( $km ) && ! is_int( $km ) ) || 1 !== preg_match( '/^\d+$/', (string) $km ) ) {
			return [ null, 'invalid_km' ];
		}
		$km_value = (int) $km;
		if ( $km_value < self::KM_MIN || $km_value > self::KM_MAX ) {
			return [ null, 'invalid_km' ];
		}

		return [
			[
				'from' => $from,
				'to'   => $to,
				'km'   => $km_value,
			],
			null,
		];
	}

	private static function pair_key( string $from, string $to ): string {
		$names = [ mb_strtolower( $from ), mb_strtolower( $to ) ];
		sort( $names );
		return implode( '|', $names );
	}

	/** @return array{string, string|null} */
	private static function sanitize_webhook_url( mixed $input, string $current ): array {
		if ( ! is_string( $input ) ) {
			return [ $current, 'invalid_url' ];
		}
		if ( '' === $input ) {
			return [ '', null ];
		}

		// phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- pure class; wp_parse_url() is unavailable without WordPress.
		$scheme = parse_url( $input, PHP_URL_SCHEME );
		if ( ! in_array( $scheme, [ 'http', 'https' ], true ) || false === filter_var( $input, FILTER_VALIDATE_URL ) ) {
			return [ $current, 'invalid_url' ];
		}

		return [ $input, null ];
	}

	/** @return array{string, string|null} */
	private static function sanitize_secret( mixed $input, string $current ): array {
		if ( ! is_string( $input ) || '' === $input ) {
			return [ $current, null ];
		}
		if ( mb_strlen( $input ) < self::SECRET_MIN_LEN ) {
			return [ $current, 'short_secret' ];
		}
		return [ $input, null ];
	}

	/**
	 * Uses `EmailRule::is_simple()`, so a saved team address never fails n8n's
	 * `isSimpleEmail()` later and silently blocks delivery.
	 *
	 * @return array{string, string|null}
	 */
	private static function sanitize_email( mixed $input, string $current ): array {
		if ( ! is_string( $input ) ) {
			return [ $current, 'invalid_email' ];
		}
		if ( '' === $input ) {
			return [ '', null ];
		}
		if ( ! EmailRule::is_simple( $input ) ) {
			return [ $current, 'invalid_email' ];
		}
		return [ $input, null ];
	}

	/**
	 * Keeps only the digits of a number typed with spaces, `+`, `-` or parentheses. A missing key
	 * (an option saved before these fields existed) keeps the current value; a blank clears it.
	 *
	 * @return array{string, string|null}
	 */
	private static function sanitize_phone( mixed $input, string $current ): array {
		if ( is_int( $input ) ) {
			// WP-CLI and a JSON round trip can store a long digit string as a number.
			$input = (string) $input;
		}
		if ( ! is_string( $input ) ) {
			return [ $current, null ];
		}
		$digits = str_replace( [ ' ', '+', '-', '(', ')' ], '', trim( $input ) );
		if ( '' === $digits ) {
			return [ '', null ];
		}
		if ( 1 !== preg_match( self::PHONE_PATTERN, $digits ) ) {
			return [ $current, 'invalid_phone' ];
		}
		return [ $digits, null ];
	}

	/** @return array{string, string|null} */
	private static function sanitize_business_text( mixed $input, string $current, int $max_length ): array {
		if ( ! is_string( $input ) ) {
			return [ $current, null ];
		}
		$text = trim( $input );
		if ( 1 === preg_match( self::CONTROL_CHARACTER_PATTERN, $text ) ) {
			return [ $current, 'invalid' ];
		}
		if ( mb_strlen( $text ) > $max_length ) {
			return [ $current, 'too_long' ];
		}
		return [ $text, null ];
	}

	/**
	 * Both ends or neither, and opening before closing. One error for the pair, which keeps both
	 * current values, so a half-saved pair never shows "07:00 to".
	 *
	 * @param SettingsShape $current
	 * @return array{string, string, string|null}
	 */
	private static function sanitize_hours( mixed $open, mixed $close, array $current ): array {
		if ( ! is_string( $open ) || ! is_string( $close ) ) {
			return [ $current['business_hours_open'], $current['business_hours_close'], null ];
		}
		$open  = trim( $open );
		$close = trim( $close );
		if ( '' === $open && '' === $close ) {
			return [ '', '', null ];
		}
		if ( 1 !== preg_match( self::HOURS_PATTERN, $open ) || 1 !== preg_match( self::HOURS_PATTERN, $close ) || strcmp( $open, $close ) >= 0 ) {
			return [ $current['business_hours_open'], $current['business_hours_close'], 'invalid_hours' ];
		}
		return [ $open, $close, null ];
	}
}
