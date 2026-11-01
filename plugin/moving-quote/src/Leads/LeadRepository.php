<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Pricing\Estimate;

/**
 * Reads and writes the leads table directly: no caching wrapper applies to a table this small,
 * and every row either feeds the admin list or the delivery outbox, both of which always want the
 * latest state.
 */
final class LeadRepository {
	/** The prefixed leads table name. */
	public function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'moving_quote_leads';
	}

	/**
	 * Inserts a new lead row from a validated draft and its server-computed estimate. Returns the
	 * inserted row, or null when `request_uuid` already exists — the one failure mode this method
	 * treats as expected, since the unique index is what makes a duplicate submission safe to
	 * retry. Any other insert failure raises `RuntimeException` instead of returning null, so a
	 * caller never mistakes an unrelated database error for a duplicate.
	 */
	public function insert( LeadDraft $draft, Estimate $estimate, int $now, int $next_attempt_at ): ?LeadRecord {
		global $wpdb;

		$extras = implode( ',', array_map( static fn ( $extra ): string => $extra->value, $draft->quote->extras ) );

		$previous_suppress = $wpdb->suppress_errors( true );
		$inserted          = $wpdb->insert(
			$this->table(),
			[
				'request_uuid'      => $draft->submission_id,
				'created_at'        => gmdate( 'Y-m-d H:i:s', $now ),
				'status'            => LeadStatus::New->value,
				'move_type'         => $draft->quote->type->value,
				'rooms'             => $draft->quote->rooms,
				'origin_city'       => $draft->quote->origin,
				'destination_city'  => $draft->quote->destination,
				'distance_km'       => $estimate->distance_km,
				'move_date'         => $draft->move_date,
				'extras'            => $extras,
				'customer_name'     => $draft->name,
				'phone'             => $draft->phone,
				'email'             => $draft->email,
				'consent_at'        => gmdate( 'Y-m-d H:i:s', $now ),
				'estimate_cop'      => $estimate->amount,
				'estimate_low_cop'  => $estimate->low,
				'estimate_high_cop' => $estimate->high,
				'sync_status'       => SyncStatus::Pending->value,
				'attempts'          => 0,
				'next_attempt_at'   => $next_attempt_at,
				'last_error'        => '',
				'sent_at'           => null,
			],
			[ '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%s', '%d', '%d', '%s', '%s' ]
		);
		$wpdb->suppress_errors( $previous_suppress );

		if ( false !== $inserted ) {
			return $this->find_by_uuid( $draft->submission_id );
		}

		$existing = $this->find_by_uuid( $draft->submission_id );
		if ( null !== $existing ) {
			return null;
		}

		// NOTE: $wpdb->last_error carries no PII only because the current schema has no unique or
		// check constraint on phone or email; a future one that did could echo the rejected value
		// back in the driver's own error text, so revisit this the moment such a constraint exists.
		// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- internal message, never rendered as HTML; logged without PII by the caller.
		throw new \RuntimeException( 'Lead insert failed: ' . $wpdb->last_error );
	}

	public function find_by_uuid( string $uuid ): ?LeadRecord {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE request_uuid = %s', $this->table(), $uuid ), ARRAY_A );
		return self::typed_row( $row );
	}

	public function find( int $id ): ?LeadRecord {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM %i WHERE id = %d', $this->table(), $id ), ARRAY_A );
		return self::typed_row( $row );
	}

	/** `get_row(..., ARRAY_A)` returns a column-name-keyed row, or null when nothing matched. */
	private static function typed_row( mixed $row ): ?LeadRecord {
		if ( ! is_array( $row ) ) {
			return null;
		}
		/** @var array<string, string|null> $row ARRAY_A always keys by column name */
		return LeadRecord::from_row( $row );
	}
}
