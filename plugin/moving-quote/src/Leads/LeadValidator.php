<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Pricing\{DistanceTable, Extra, MoveType, QuoteInput};

/**
 * Collects every error instead of stopping at the first. Pure: errors are stable codes, mapped to
 * display text by `Rest\Messages`.
 */
final class LeadValidator {
	private const ROOMS_MIN                = 1;
	private const ROOMS_MAX                = 5;
	private const NAME_MIN_LEN             = 2;
	private const NAME_MAX_LEN             = 100;
	private const EMAIL_MAX_LEN            = 254;
	public const PHONE_MIN_LEN             = 10;
	public const PHONE_MAX_LEN             = 15;
	private const MOVE_DATE_MAX_DAYS_AHEAD = 365;

	/**
	 * Only the fields that affect price, for the estimate endpoint.
	 *
	 * @param array<string, mixed> $input
	 */
	public static function quote( array $input, DistanceTable $distances ): QuoteInput|FieldErrors {
		$errors = [];
		$fields = self::validate_price_fields( $input, $distances, $errors );

		if ( [] !== $errors ) {
			return new FieldErrors( $errors );
		}

		return new QuoteInput( $fields['move_type'], $fields['rooms'], $fields['origin'], $fields['destination'], $fields['extras'] );
	}

	/**
	 * @param array<string, mixed> $input
	 */
	public static function lead( array $input, DistanceTable $distances, \DateTimeImmutable $now, \DateTimeZone $tz ): LeadDraft|FieldErrors {
		$errors = [];

		$submission_id = self::validate_submission_id( $input['submission_id'] ?? null, $errors );
		$price_fields  = self::validate_price_fields( $input, $distances, $errors );
		$move_date     = self::validate_move_date( $input['move_date'] ?? null, $now, $tz, $errors );
		$name          = self::validate_name( $input['name'] ?? null, $errors );
		$phone         = self::validate_phone( $input['phone'] ?? null, $errors );
		$email         = self::validate_email( $input['email'] ?? null, $errors );
		self::validate_consent( $input['consent'] ?? null, $errors );

		if ( [] !== $errors ) {
			return new FieldErrors( $errors );
		}

		$quote = new QuoteInput( $price_fields['move_type'], $price_fields['rooms'], $price_fields['origin'], $price_fields['destination'], $price_fields['extras'] );
		return new LeadDraft( $submission_id, $quote, $move_date, $name, $phone, $email );
	}

	/**
	 * Returns every normalized value even when invalid, so a caller that only checks `$errors`
	 * never guards a missing key.
	 *
	 * @param array<string, mixed> $input
	 * @param array<string, string> $errors
	 * @return array{move_type: MoveType, rooms: int, origin: string, destination: string, extras: list<Extra>}
	 */
	private static function validate_price_fields( array $input, DistanceTable $distances, array &$errors ): array {
		$move_type   = self::validate_move_type( $input['move_type'] ?? null, $errors );
		$rooms       = self::validate_rooms( $input['rooms'] ?? null, $errors );
		$origin      = self::validate_city( 'origin', $input['origin'] ?? null, $distances, $errors );
		$destination = self::validate_destination( $input['destination'] ?? null, $origin, $distances, $errors );
		$extras      = self::validate_extras( $input['extras'] ?? [], $errors );

		return [
			'move_type'   => $move_type,
			'rooms'       => $rooms,
			'origin'      => $origin,
			'destination' => $destination,
			'extras'      => $extras,
		];
	}

	/** @param array<string, string> $errors */
	private static function validate_submission_id( mixed $value, array &$errors ): string {
		if ( null === $value ) {
			$errors['submission_id'] = 'required';
			return '';
		}
		if ( ! is_string( $value ) || 1 !== preg_match( '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i', $value ) ) {
			$errors['submission_id'] = 'invalid';
			return '';
		}
		return strtolower( $value );
	}

	/** @param array<string, string> $errors */
	private static function validate_move_type( mixed $value, array &$errors ): MoveType {
		if ( null === $value ) {
			$errors['move_type'] = 'required';
			return MoveType::Apartment;
		}
		$type = is_string( $value ) ? MoveType::tryFrom( $value ) : null;
		if ( null === $type ) {
			$errors['move_type'] = 'invalid';
			return MoveType::Apartment;
		}
		return $type;
	}

	/** @param array<string, string> $errors */
	private static function validate_rooms( mixed $value, array &$errors ): int {
		if ( null === $value ) {
			$errors['rooms'] = 'required';
			return self::ROOMS_MIN;
		}
		$rooms = self::strict_integer( $value );
		if ( null === $rooms || $rooms < self::ROOMS_MIN || $rooms > self::ROOMS_MAX ) {
			$errors['rooms'] = 'invalid';
			return self::ROOMS_MIN;
		}
		return $rooms;
	}

	/** Parses an int, or a numeric string with no sign, decimal point, or exponent; otherwise null. */
	private static function strict_integer( mixed $value ): ?int {
		if ( is_int( $value ) ) {
			return $value;
		}
		if ( is_string( $value ) && 1 === preg_match( '/^\d+$/', $value ) ) {
			return (int) $value;
		}
		return null;
	}

	/**
	 * Normalizes a case-insensitive match to the configured spelling: `DistanceTable::distance_km()`
	 * looks routes up by exact string, so "cartagena" would otherwise find no route.
	 *
	 * @param array<string, string> $errors
	 */
	private static function validate_city( string $field, mixed $value, DistanceTable $distances, array &$errors ): string {
		if ( null === $value ) {
			$errors[ $field ] = 'required';
			return '';
		}
		if ( ! is_string( $value ) || '' === $value ) {
			$errors[ $field ] = 'invalid';
			return '';
		}
		$canonical = self::canonical_city( $value, $distances );
		if ( null === $canonical ) {
			$errors[ $field ] = 'unknown_city';
			return $value;
		}
		return $canonical;
	}

	private static function canonical_city( string $city, DistanceTable $distances ): ?string {
		foreach ( $distances->cities() as $known ) {
			if ( 0 === strcasecmp( $known, $city ) ) {
				return $known;
			}
		}
		return null;
	}

	/**
	 * Checks the route only once both cities are known, and reports a missing one on `destination`.
	 *
	 * @param array<string, string> $errors
	 */
	private static function validate_destination( mixed $value, string $origin, DistanceTable $distances, array &$errors ): string {
		$destination_errors = [];
		$destination        = self::validate_city( 'destination', $value, $distances, $destination_errors );

		if ( [] !== $destination_errors ) {
			$errors = [ ...$errors, ...$destination_errors ];
			return $destination;
		}

		if ( isset( $errors['origin'] ) ) {
			// The origin itself is unreported-or-worse; a route check against it would be noise.
			return $destination;
		}

		if ( null === $distances->distance_km( $origin, $destination ) ) {
			$errors['destination'] = 'unknown_route';
		}

		return $destination;
	}

	/**
	 * @param array<string, string> $errors
	 * @return list<Extra>
	 */
	private static function validate_extras( mixed $value, array &$errors ): array {
		if ( ! is_array( $value ) ) {
			$errors['extras'] = 'invalid';
			return [];
		}

		$extras = [];
		foreach ( $value as $item ) {
			if ( ! is_string( $item ) ) {
				$errors['extras'] = 'invalid';
				return [];
			}
			$extra = Extra::tryFrom( $item );
			if ( null === $extra ) {
				$errors['extras'] = 'invalid';
				return [];
			}
			if ( ! in_array( $extra, $extras, true ) ) {
				$extras[] = $extra;
			}
		}

		return $extras;
	}

	/** @param array<string, string> $errors */
	private static function validate_move_date( mixed $value, \DateTimeImmutable $now, \DateTimeZone $tz, array &$errors ): string {
		if ( null === $value ) {
			$errors['move_date'] = 'required';
			return '';
		}
		if ( ! is_string( $value ) || 1 !== preg_match( '/^(\d{4})-(\d{2})-(\d{2})$/', $value, $m ) || ! checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ) {
			$errors['move_date'] = 'invalid';
			return '';
		}

		$today    = $now->setTimezone( $tz )->format( 'Y-m-d' );
		$max_date = $now->setTimezone( $tz )->modify( '+' . self::MOVE_DATE_MAX_DAYS_AHEAD . ' days' )->format( 'Y-m-d' );

		if ( $value < $today ) {
			$errors['move_date'] = 'past_date';
			return $value;
		}
		if ( $value > $max_date ) {
			$errors['move_date'] = 'too_far';
			return $value;
		}

		return $value;
	}

	/**
	 * C0 controls, DEL, NEL, U+2028, U+2029. `LeadController` passes the raw JSON body here with no
	 * `sanitize_text_field()` pass, so this is the only line-break guard.
	 */
	private const CONTROL_CHARACTER_PATTERN = '/[\x{0000}-\x{001F}\x{007F}\x{0085}\x{2028}\x{2029}]+/u';

	/** @param array<string, string> $errors */
	private static function validate_name( mixed $value, array &$errors ): string {
		if ( null === $value ) {
			$errors['name'] = 'required';
			return '';
		}
		if ( ! is_string( $value ) ) {
			$errors['name'] = 'invalid';
			return '';
		}
		$normalized = preg_replace( self::CONTROL_CHARACTER_PATTERN, ' ', $value );
		if ( null === $normalized ) {
			// Null here means $value isn't valid UTF-8 (the /u modifier refuses it).
			$errors['name'] = 'invalid';
			return '';
		}
		$trimmed = trim( $normalized );
		$length  = mb_strlen( $trimmed );
		if ( $length < self::NAME_MIN_LEN ) {
			$errors['name'] = 'too_short';
			return $trimmed;
		}
		if ( $length > self::NAME_MAX_LEN ) {
			$errors['name'] = 'too_long';
			return $trimmed;
		}
		return $trimmed;
	}

	/** @param array<string, string> $errors */
	private static function validate_phone( mixed $value, array &$errors ): string {
		if ( null === $value ) {
			$errors['phone'] = 'required';
			return '';
		}
		if ( ! is_string( $value ) ) {
			$errors['phone'] = 'invalid';
			return '';
		}
		$digits = preg_replace( '/[\s().+-]/', '', $value );
		if ( ! is_string( $digits ) || 1 !== preg_match( '/^\d+$/', $digits ) ) {
			$errors['phone'] = 'invalid';
			return '';
		}
		$length = strlen( $digits );
		if ( $length < self::PHONE_MIN_LEN || $length > self::PHONE_MAX_LEN ) {
			$errors['phone'] = 'invalid';
			return $digits;
		}
		return $digits;
	}

	/** See `is_simple_email()`. */
	private const FORBIDDEN_EMAIL_CHARACTER_PATTERN = '/[\s\x{0000}-\x{001F}\x{007F}"(),;:<>[\]\\\\]/u';

	/** @param array<string, string> $errors */
	private static function validate_email( mixed $value, array &$errors ): string {
		if ( null === $value ) {
			$errors['email'] = 'required';
			return '';
		}
		if ( ! is_string( $value ) || mb_strlen( $value ) > self::EMAIL_MAX_LEN || ! self::is_simple_email( $value ) ) {
			$errors['email'] = 'invalid';
			return '';
		}
		return $value;
	}

	/**
	 * `FILTER_VALIDATE_EMAIL`, minus whitespace, controls, and `" , ; < > ( ) [ ] : \`. The filter
	 * alone accepts `"a,b"@example.com`, which n8n's Gmail node splits into two recipients. Shared
	 * with `Settings\SettingsSanitizer`; matches `isSimpleEmail()` in `src/nodes/lead.ts`.
	 */
	public static function is_simple_email( string $value ): bool {
		if ( false === filter_var( $value, FILTER_VALIDATE_EMAIL ) ) {
			return false;
		}
		return 1 !== preg_match( self::FORBIDDEN_EMAIL_CHARACTER_PATTERN, $value );
	}

	/** @param array<string, string> $errors */
	private static function validate_consent( mixed $value, array &$errors ): void {
		if ( true !== $value ) {
			$errors['consent'] = 'consent_required';
		}
	}
}
