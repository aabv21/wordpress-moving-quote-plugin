<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests;

/**
 * Shared fixture data for tests that need a fully-formed lead row, as `$wpdb` would return it:
 * every value a string, exactly as MySQL hands it back.
 */
final class Fixtures {
	/**
	 * One leads-table row, matching the lead payload fixture (same customer, move, and estimate).
	 *
	 * @return array<string, string|null>
	 */
	public static function lead_row(): array {
		return [
			'id'                => '7',
			'request_uuid'      => '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b',
			'created_at'        => '2026-11-04 14:15:00',
			'status'            => 'new',
			'move_type'         => 'apartment',
			'rooms'             => '2',
			'origin_city'       => 'Barranquilla',
			'destination_city'  => 'Cartagena',
			'distance_km'       => '120',
			'move_date'         => '2026-11-20',
			'extras'            => 'packing',
			'customer_name'     => 'José Peña',
			'phone'             => '570000000001',
			'email'             => 'jose@example.com',
			'consent_at'        => '2026-11-04 14:15:00',
			'estimate_cop'      => '1330000',
			'estimate_low_cop'  => '1197000',
			'estimate_high_cop' => '1463000',
			'sync_status'       => 'pending',
			'attempts'          => '0',
			'next_attempt_at'   => '1793802900',
			'last_error'        => '',
			'sent_at'           => null,
		];
	}
}
