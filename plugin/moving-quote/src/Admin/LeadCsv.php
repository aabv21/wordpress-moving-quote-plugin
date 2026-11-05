<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\LeadRecord;

final class LeadCsv {
	/** @var list<string> */
	public const HEADER = [ 'received_at', 'reference', 'status', 'name', 'phone', 'email', 'move_date', 'move_type', 'rooms', 'origin', 'destination', 'distance_km', 'extras', 'estimate_cop', 'estimate_low_cop', 'estimate_high_cop', 'sync_status', 'locale' ];

	/**
	 * `received_at` is `created_at` (UTC) in `$tz`. Every other field is the raw stored value, not
	 * its label, so the export matches the database whatever the admin's language.
	 *
	 * @return list<string>
	 */
	public static function row( LeadRecord $lead, \DateTimeZone $tz ): array {
		$received_at = ( new \DateTimeImmutable( $lead->created_at, new \DateTimeZone( 'UTC' ) ) )->setTimezone( $tz )->format( 'Y-m-d H:i' );

		return [
			CsvEscaper::cell( $received_at ),
			CsvEscaper::cell( $lead->reference() ),
			CsvEscaper::cell( $lead->status->value ),
			CsvEscaper::cell( $lead->customer_name ),
			CsvEscaper::cell( $lead->phone ),
			CsvEscaper::cell( $lead->email ),
			CsvEscaper::cell( $lead->move_date ),
			CsvEscaper::cell( $lead->move_type ),
			CsvEscaper::cell( $lead->rooms ),
			CsvEscaper::cell( $lead->origin_city ),
			CsvEscaper::cell( $lead->destination_city ),
			CsvEscaper::cell( $lead->distance_km ),
			CsvEscaper::cell( implode( ',', $lead->extras ) ),
			CsvEscaper::cell( $lead->estimate_cop ),
			CsvEscaper::cell( $lead->estimate_low_cop ),
			CsvEscaper::cell( $lead->estimate_high_cop ),
			CsvEscaper::cell( $lead->sync_status->value ),
			CsvEscaper::cell( $lead->locale ),
		];
	}
}
