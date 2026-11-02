<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Pricing\{DistanceTable, Extra, MoveType, QuoteInput};

/**
 * Validates and normalizes a quote or lead submission against the plugin's limits, collecting every
 * error instead of stopping at the first one. Never calls a WordPress function: every message is a
 * stable code, mapped to display text by `Rest\Messages`.
 */
final class LeadValidator {
	private const ROOMS_MIN                = 1;
	private const ROOMS_MAX                = 5;
	private const NAME_MIN_LEN             = 2;
	private const NAME_MAX_LEN             = 100;
	private const EMAIL_MAX_LEN            = 254;
	private const PHONE_MIN_LEN            = 10;
	private const PHONE_MAX_LEN            = 15;
	private const MOVE_DATE_MAX_DAYS_AHEAD = 365;

	/**
	 * Validates only the fields that affect price: move type, rooms, origin, destination, and
	 * extras. Used by the estimate endpoint, which has no customer or consent fields.
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
	 * Validates every lead field, in the order: submission_id, move_type, rooms, origin,
	 * destination, extras, move_date, name, phone, email, consent.
	 *
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
	 * Validates move_type, rooms, origin, destination, and extras, in that order, appending any
	 * failure to `$errors` by reference. Returns every field's normalized value regardless of
	 * whether it was valid, so a caller that only inspects `$errors` never has to guard a missing
	 * array key.
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

	/** @param array<string, string> $errors */
	private static function validate_city( string $field, mixed $value, DistanceTable $distances, array &$errors ): string {
		if ( null === $value ) {
			$errors[ $field ] = 'required';
			return '';
		}
		if ( ! is_string( $value ) || '' === $value ) {
			$errors[ $field ] = 'invalid';
			return '';
		}
		if ( ! self::city_known( $value, $distances ) ) {
			$errors[ $field ] = 'unknown_city';
			return $value;
		}
		return $value;
	}

	private static function city_known( string $city, DistanceTable $distances ): bool {
		foreach ( $distances->cities() as $known ) {
			if ( 0 === strcasecmp( $known, $city ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Validates the destination city, then — only once both cities are individually known —
	 * whether a route exists between them, reporting a missing route on `destination` per the
	 * contract.
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
	 * C0 controls, DEL, NEL, LINE SEPARATOR, and PARAGRAPH SEPARATOR — the set a `LeadController`
	 * REST submission can still carry, since `LeadController` passes the raw JSON body straight to
	 * this validator with no `sanitize_text_field()` pass first (that function exists, but nothing
	 * calls it for this route).
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
			// preg_replace() returns null only on a PCRE-level failure, which for this pattern
			// means $value isn't valid UTF-8 (the /u modifier refuses to run on it).
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

	/**
	 * A simple address only: none of `" , ; < > ( ) [ ] : \`, and no whitespace or control
	 * character, anywhere in the value. `FILTER_VALIDATE_EMAIL` alone accepts a quoted local part
	 * such as `"a,b"@example.com`, which n8n's Gmail node splits on the comma into a second
	 * recipient — this rejects exactly what that quoting would otherwise smuggle through.
	 */
	private const FORBIDDEN_EMAIL_CHARACTER_PATTERN = '/[\s\x{0000}-\x{001F}\x{007F}"(),;:<>[\]\\\\]/u';

	/** @param array<string, string> $errors */
	private static function validate_email( mixed $value, array &$errors ): string {
		if ( null === $value ) {
			$errors['email'] = 'required';
			return '';
		}
		if ( ! is_string( $value ) || mb_strlen( $value ) > self::EMAIL_MAX_LEN || false === filter_var( $value, FILTER_VALIDATE_EMAIL ) ) {
			$errors['email'] = 'invalid';
			return '';
		}
		if ( 1 === preg_match( self::FORBIDDEN_EMAIL_CHARACTER_PATTERN, $value ) ) {
			$errors['email'] = 'invalid';
			return '';
		}
		return $value;
	}

	/** @param array<string, string> $errors */
	private static function validate_consent( mixed $value, array &$errors ): void {
		if ( true !== $value ) {
			$errors['consent'] = 'consent_required';
		}
	}
}
