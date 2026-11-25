<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\Labels;
use Chivabox\MovingQuote\Leads\LeadRecord;
use Chivabox\MovingQuote\Leads\LeadRepository;
use Chivabox\MovingQuote\Plugin;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Core's personal-data tools, keyed by email. Core requires `manage_options` and owns the request
 * lifecycle, so neither callback checks a capability or nonce of its own.
 */
final class PersonalData {
	/** How long n8n keeps a failed run's data: `compose.yaml`'s `EXECUTIONS_DATA_MAX_AGE`, 168 hours. */
	public const EXECUTION_RETENTION_DAYS = 7;

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
		// One page: a single visitor's lead count is small.
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
		$tz = new DateTimeZone( Plugin::TIMEZONE );

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
					'value' => Labels::status( $lead->status ),
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
					'value' => Labels::move_type( $lead->move_type ),
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
					'value' => implode( ', ', array_map( [ Labels::class, 'extra' ], $lead->extras ) ),
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
				[
					'name'  => __( 'Team notes', 'moving-quote' ),
					'value' => $lead->notes,
				],
				[
					/* translators: the site language the request was submitted in, e.g. es_CO */
					'name'  => __( 'Language', 'moving-quote' ),
					'value' => $lead->locale,
				],
			],
		];
	}

	private static function bogota_time( string $stored, DateTimeZone $tz ): string {
		return ( new DateTimeImmutable( $stored, new DateTimeZone( 'UTC' ) ) )->setTimezone( $tz )->format( 'Y-m-d H:i:s' );
	}

	/**
	 * Deletes without parsing, so a row with an unparseable `status` is still erased.
	 *
	 * Not a full erasure: copies can remain in the sheet, the two sent emails, and for up to 168 h
	 * a failed n8n execution (see "Token retention, precisely" in `docs/architecture.md`). When a
	 * row is deleted, this reports `items_retained` and names each `MQ-…` reference to remove by hand.
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

		$repository = new LeadRepository();
		$uuids      = $repository->uuids_by_email( $email_address );
		$deleted    = $repository->delete_by_uuids( $uuids );

		if ( 0 === $deleted ) {
			return [
				'items_removed'  => false,
				'items_retained' => false,
				'messages'       => [],
				'done'           => true,
			];
		}

		$references = array_map( [ LeadRecord::class, 'reference_for' ], $uuids );

		return [
			'items_removed'  => true,
			'items_retained' => true,
			'messages'       => [
				sprintf(
					/* translators: 1: a comma-separated list of MQ-… lead references, 2: a number of days */
					__( 'The database record for %1$s was deleted, but a copy may still exist in the Moving leads Google Sheet, in the "New lead" emails already sent to the team and the customer, and — for up to %2$d days — in a failed delivery\'s stored n8n execution data. Remove those by hand if needed.', 'moving-quote' ),
					implode( ', ', $references ),
					self::EXECUTION_RETENTION_DAYS
				),
			],
			'done'           => true,
		];
	}
}
