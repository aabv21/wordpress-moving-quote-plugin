<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Settings;

/**
 * Validates and normalizes the settings form's posted strings into the typed settings shape,
 * without calling any WordPress function. A field that fails validation keeps its value from the
 * current settings, and every failure is reported with a stable error code.
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

	/**
	 * @param array<string, mixed> $input   the posted form, or the sanitizer's own output fed back
	 * @param SettingsShape        $current the settings to fall back to on a per-field error
	 */
	public static function sanitize( array $input, array $current ): SanitizedSettings {
		$errors = [];

		[ $base_rates, $base_rate_errors ] = self::sanitize_base_rates( is_array( $input['base_rates'] ?? null ) ? $input['base_rates'] : [], $current['base_rates'] );
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

		[ $extras, $extras_errors ] = self::sanitize_extras( is_array( $input['extras'] ?? null ) ? $input['extras'] : [], $current['extras'] );
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

		$settings = [
			'base_rates'     => $base_rates,
			'per_room'       => $per_room,
			'per_km'         => $per_km,
			'extras'         => $extras,
			'range_percent'  => $range_percent,
			'routes'         => $routes,
			'webhook_url'    => $webhook_url,
			'webhook_secret' => $webhook_secret,
			'team_email'     => $team_email,
		];

		return new SanitizedSettings( $settings, $errors );
	}

	/**
	 * @param array<string, mixed>                            $input
	 * @param array{apartment: int, house: int, office: int} $current
	 * @return array{array{apartment: int, house: int, office: int}, array<string, string>}
	 */
	private static function sanitize_base_rates( array $input, array $current ): array {
		$errors = [];

		[ $apartment, $apartment_error ] = self::sanitize_amount( $input['apartment'] ?? null, $current['apartment'] );
		if ( null !== $apartment_error ) {
			$errors['apartment'] = $apartment_error;
		}
		[ $house, $house_error ] = self::sanitize_amount( $input['house'] ?? null, $current['house'] );
		if ( null !== $house_error ) {
			$errors['house'] = $house_error;
		}
		[ $office, $office_error ] = self::sanitize_amount( $input['office'] ?? null, $current['office'] );
		if ( null !== $office_error ) {
			$errors['office'] = $office_error;
		}

		return [
			[
				'apartment' => $apartment,
				'house'     => $house,
				'office'    => $office,
			],
			$errors,
		];
	}

	/**
	 * @param array<string, mixed>                                                            $input
	 * @param array{packing: int, furniture_assembly: int, storage: int, piano_fragile: int} $current
	 * @return array{array{packing: int, furniture_assembly: int, storage: int, piano_fragile: int}, array<string, string>}
	 */
	private static function sanitize_extras( array $input, array $current ): array {
		$errors = [];

		[ $packing, $packing_error ] = self::sanitize_amount( $input['packing'] ?? null, $current['packing'] );
		if ( null !== $packing_error ) {
			$errors['packing'] = $packing_error;
		}
		[ $furniture_assembly, $furniture_error ] = self::sanitize_amount( $input['furniture_assembly'] ?? null, $current['furniture_assembly'] );
		if ( null !== $furniture_error ) {
			$errors['furniture_assembly'] = $furniture_error;
		}
		[ $storage, $storage_error ] = self::sanitize_amount( $input['storage'] ?? null, $current['storage'] );
		if ( null !== $storage_error ) {
			$errors['storage'] = $storage_error;
		}
		[ $piano_fragile, $piano_error ] = self::sanitize_amount( $input['piano_fragile'] ?? null, $current['piano_fragile'] );
		if ( null !== $piano_error ) {
			$errors['piano_fragile'] = $piano_error;
		}

		return [
			[
				'packing'            => $packing,
				'furniture_assembly' => $furniture_assembly,
				'storage'            => $storage,
				'piano_fragile'      => $piano_fragile,
			],
			$errors,
		];
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

	/** Strips Colombian-style thousands separators (`.`, `,`, space) from a matching amount string, or returns null when it doesn't match. */
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
			$row_number = $index + 1;
			if ( ! is_array( $row ) ) {
				continue;
			}

			$from = is_string( $row['from'] ?? null ) ? trim( $row['from'] ) : '';
			$to   = is_string( $row['to'] ?? null ) ? trim( $row['to'] ) : '';
			$km   = $row['km'] ?? null;

			if ( '' === $from && '' === $to ) {
				continue;
			}

			if ( ! empty( $row['remove'] ) ) {
				continue;
			}

			$key = "routes.{$row_number}";

			if ( mb_strlen( $from ) < self::CITY_MIN_LEN || mb_strlen( $from ) > self::CITY_MAX_LEN
				|| mb_strlen( $to ) < self::CITY_MIN_LEN || mb_strlen( $to ) > self::CITY_MAX_LEN
			) {
				$errors[ $key ] = 'invalid_city';
				continue;
			}

			if ( 0 === strcasecmp( $from, $to ) ) {
				$errors[ $key ] = 'same_city';
				continue;
			}

			if ( ( ! is_string( $km ) && ! is_int( $km ) ) || 1 !== preg_match( '/^\d+$/', (string) $km ) ) {
				$errors[ $key ] = 'invalid_km';
				continue;
			}
			$km_value = (int) $km;
			if ( $km_value < self::KM_MIN || $km_value > self::KM_MAX ) {
				$errors[ $key ] = 'invalid_km';
				continue;
			}

			$pair_key = self::pair_key( $from, $to );
			if ( isset( $seen_pairs[ $pair_key ] ) ) {
				$errors[ $key ] = 'duplicate_route';
				continue;
			}
			$seen_pairs[ $pair_key ] = true;

			$rows[] = [
				'from' => $from,
				'to'   => $to,
				'km'   => $km_value,
			];
		}

		if ( [] === $errors && [] === $rows ) {
			$errors['routes'] = 'no_routes';
		}

		if ( [] !== $errors ) {
			return [ $current, $errors ];
		}

		return [ $rows, $errors ];
	}

	/** A case-insensitive, direction-independent key identifying a city pair. */
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

	/** @return array{string, string|null} */
	private static function sanitize_email( mixed $input, string $current ): array {
		if ( ! is_string( $input ) ) {
			return [ $current, 'invalid_email' ];
		}
		if ( '' === $input ) {
			return [ '', null ];
		}
		if ( false === filter_var( $input, FILTER_VALIDATE_EMAIL ) ) {
			return [ $current, 'invalid_email' ];
		}
		return [ $input, null ];
	}
}
