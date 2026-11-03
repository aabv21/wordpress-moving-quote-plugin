<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

/**
 * A leads-table row, typed from the string values `$wpdb` returns. Every property is named after
 * its column. `locale` is the site language the lead was submitted under (`determine_locale()`),
 * or `''` for a row saved before that column existed.
 */
final readonly class LeadRecord {
	/** @param list<string> $extras */
	public function __construct(
		public int $id,
		public string $request_uuid,
		public string $created_at,
		public LeadStatus $status,
		public string $move_type,
		public int $rooms,
		public string $origin_city,
		public string $destination_city,
		public int $distance_km,
		public string $move_date,
		public array $extras,
		public string $customer_name,
		public string $phone,
		public string $email,
		public string $consent_at,
		public int $estimate_cop,
		public int $estimate_low_cop,
		public int $estimate_high_cop,
		public SyncStatus $sync_status,
		public int $attempts,
		public int $next_attempt_at,
		public string $last_error,
		public ?string $sent_at,
		public string $locale = ''
	) {
	}

	/** @param array<string, string|null> $row a `$wpdb` row, every value a string (or null for a nullable column) */
	public static function from_row( array $row ): self {
		$extras = '' === $row['extras'] ? [] : explode( ',', (string) $row['extras'] );

		return new self(
			(int) $row['id'],
			(string) $row['request_uuid'],
			(string) $row['created_at'],
			LeadStatus::from( (string) $row['status'] ),
			(string) $row['move_type'],
			(int) $row['rooms'],
			(string) $row['origin_city'],
			(string) $row['destination_city'],
			(int) $row['distance_km'],
			(string) $row['move_date'],
			$extras,
			(string) $row['customer_name'],
			(string) $row['phone'],
			(string) $row['email'],
			(string) $row['consent_at'],
			(int) $row['estimate_cop'],
			(int) $row['estimate_low_cop'],
			(int) $row['estimate_high_cop'],
			SyncStatus::from( (string) $row['sync_status'] ),
			(int) $row['attempts'],
			(int) $row['next_attempt_at'],
			(string) $row['last_error'],
			$row['sent_at'],
			(string) ( $row['locale'] ?? '' )
		);
	}

	/** The short, customer-facing reference: `MQ-` plus the first 8 hex of the request UUID, uppercased. */
	public function reference(): string {
		return self::reference_for( $this->request_uuid );
	}

	/**
	 * The same reference `reference()` builds, from a bare `request_uuid` with no full
	 * `LeadRecord` needed — used where a row exists only as an id (e.g. the personal-data
	 * eraser naming a lead whose copies elsewhere it can't reach, before or instead of parsing
	 * the row into a record at all).
	 */
	public static function reference_for( string $request_uuid ): string {
		$hex = str_replace( '-', '', $request_uuid );
		return 'MQ-' . strtoupper( substr( $hex, 0, 8 ) );
	}

	/**
	 * True when `$value` has the exact shape `reference_for()` produces: `MQ-` and 8 uppercase hex
	 * digits. The thank-you page echoes a reference back from its own query string, so nothing
	 * else may ever reach that output.
	 */
	public static function is_reference( string $value ): bool {
		return 1 === preg_match( '/^MQ-[0-9A-F]{8}$/D', $value );
	}
}
