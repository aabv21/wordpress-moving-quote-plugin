<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\LeadRecord;
use Chivabox\MovingQuote\Leads\LeadRepository;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Registers this plugin's leads with WordPress core's own personal-data tools (Tools → Export/
 * Erase Personal Data), both keyed by email: the exporter returns every matching lead's fields,
 * the eraser deletes every matching row. Core itself requires `manage_options` to reach either
 * screen and owns the whole request lifecycle (the confirmation email, the retry on failure), so
 * neither callback here checks a capability or a nonce of its own.
 */
final class PersonalData {
	public static function register(): void {
		add_filter( 'wp_privacy_personal_data_exporters', [ self::class, 'register_exporter' ] );
		add_filter( 'wp_privacy_personal_data_erasers', [ self::class, 'register_eraser' ] );
	}

	/**
	 * @param array<string, array{exporter_friendly_name: string, callback: callable}> $exporters
	 * @return array<string, array{exporter_friendly_name: string, callback: callable}>
	 */
	public static function register_exporter( array $exporters ): array {
		$exporters['moving-quote-leads'] = [
			'exporter_friendly_name' => __( 'Moving quote leads', 'moving-quote' ),
			'callback'               => [ self::class, 'export' ],
		];
		return $exporters;
	}

	/**
	 * @param array<string, array{eraser_friendly_name: string, callback: callable}> $erasers
	 * @return array<string, array{eraser_friendly_name: string, callback: callable}>
	 */
	public static function register_eraser( array $erasers ): array {
		$erasers['moving-quote-leads'] = [
			'eraser_friendly_name' => __( 'Moving quote leads', 'moving-quote' ),
			'callback'             => [ self::class, 'erase' ],
		];
		return $erasers;
	}

	/**
	 * @return array{data: list<array{group_id: string, group_label: string, item_id: string, data: list<array{name: string, value: string}>}>, done: bool}
	 */
	public static function export( string $email_address, int $page = 1 ): array {
		// Every matching lead is returned on page 1; there is no per-page limit here because a
		// single visitor's lead count is small, unlike the admin CSV export's own batching.
		if ( $page > 1 ) {
			return [
				'data' => [],
				'done' => true,
			];
		}

		$leads = ( new LeadRepository() )->find_by_email( $email_address );
		$data  = array_map( [ self::class, 'export_item' ], $leads );

		return [
			'data' => $data,
			'done' => true,
		];
	}

	/** @return array{group_id: string, group_label: string, item_id: string, data: list<array{name: string, value: string}>} */
	private static function export_item( LeadRecord $lead ): array {
		$tz = new DateTimeZone( 'America/Bogota' );

		return [
			'group_id'    => 'moving-quote-leads',
			'group_label' => __( 'Moving quote leads', 'moving-quote' ),
			'item_id'     => 'moving-quote-lead-' . $lead->id,
			'data'        => [
				[
					'name'  => __( 'Reference', 'moving-quote' ),
					'value' => $lead->reference(),
				],
				[
					'name'  => __( 'Status', 'moving-quote' ),
					'value' => LeadsListTable::status_label( $lead->status ),
				],
				[
					/* translators: the submission time is converted to America/Bogota */
					'name'  => __( 'Submitted (America/Bogota)', 'moving-quote' ),
					'value' => self::bogota_time( $lead->created_at, $tz ),
				],
				[
					'name'  => __( 'Name', 'moving-quote' ),
					'value' => $lead->customer_name,
				],
				[
					'name'  => __( 'Phone', 'moving-quote' ),
					'value' => $lead->phone,
				],
				[
					'name'  => __( 'Email', 'moving-quote' ),
					'value' => $lead->email,
				],
				[
					/* translators: the consent time is converted to America/Bogota */
					'name'  => __( 'Consent given (America/Bogota)', 'moving-quote' ),
					'value' => self::bogota_time( $lead->consent_at, $tz ),
				],
				[
					'name'  => __( 'Move type', 'moving-quote' ),
					'value' => $lead->move_type,
				],
				[
					'name'  => __( 'Rooms', 'moving-quote' ),
					'value' => (string) $lead->rooms,
				],
				[
					'name'  => __( 'Origin', 'moving-quote' ),
					'value' => $lead->origin_city,
				],
				[
					'name'  => __( 'Destination', 'moving-quote' ),
					'value' => $lead->destination_city,
				],
				[
					'name'  => __( 'Distance (km)', 'moving-quote' ),
					'value' => (string) $lead->distance_km,
				],
				[
					'name'  => __( 'Move date', 'moving-quote' ),
					'value' => $lead->move_date,
				],
				[
					'name'  => __( 'Extras', 'moving-quote' ),
					'value' => implode( ', ', $lead->extras ),
				],
				[
					'name'  => __( 'Estimate amount (COP)', 'moving-quote' ),
					'value' => (string) $lead->estimate_cop,
				],
				[
					'name'  => __( 'Estimate low (COP)', 'moving-quote' ),
					'value' => (string) $lead->estimate_low_cop,
				],
				[
					'name'  => __( 'Estimate high (COP)', 'moving-quote' ),
					'value' => (string) $lead->estimate_high_cop,
				],
			],
		];
	}

	/** `$stored` (UTC, `Y-m-d H:i:s`) converted to `$tz` and formatted the same way. */
	private static function bogota_time( string $stored, DateTimeZone $tz ): string {
		return ( new DateTimeImmutable( $stored, new DateTimeZone( 'UTC' ) ) )->setTimezone( $tz )->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Deletes every lead matching `$email_address` in one statement
	 * (`LeadRepository::delete_by_email()`), rather than parsing each row first and deleting it by
	 * id — a row whose `status` `LeadRecord::from_row()` can't parse (which the exporter's own
	 * `find_by_email()` would skip) must still be erased, since an erasure request exists
	 * precisely to remove data the parsed view doesn't need to make sense of first.
	 *
	 * @return array{items_removed: bool, items_retained: bool, messages: list<string>, done: bool}
	 */
	public static function erase( string $email_address, int $page = 1 ): array {
		if ( $page > 1 ) {
			return [
				'items_removed'  => false,
				'items_retained' => false,
				'messages'       => [],
				'done'           => true,
			];
		}

		$deleted = ( new LeadRepository() )->delete_by_email( $email_address );

		return [
			'items_removed'  => $deleted > 0,
			'items_retained' => false,
			'messages'       => [],
			'done'           => true,
		];
	}
}
