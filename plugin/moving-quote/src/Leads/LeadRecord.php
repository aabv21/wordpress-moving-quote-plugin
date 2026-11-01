<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

/**
 * A leads-table row, typed from the string values `$wpdb` returns. Every property is named after
 * its column.
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
		public ?string $sent_at
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
			$row['sent_at']
		);
	}

	/** The short, customer-facing reference: `MQ-` plus the first 8 hex of the request UUID, uppercased. */
	public function reference(): string {
		$hex = str_replace( '-', '', $this->request_uuid );
		return 'MQ-' . strtoupper( substr( $hex, 0, 8 ) );
	}
}
