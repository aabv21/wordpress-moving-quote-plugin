<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Delivery\SyncUpdate;
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

	/**
	 * Pending rows due for delivery (`next_attempt_at <= $now`), oldest first, up to `$limit`. The
	 * raw rows are returned as-is, not converted through `LeadRecord::from_row()`: a row an unknown
	 * future `status` value would make that conversion throw on must still reach the caller, so it
	 * can record the failure and move on to the next row instead of losing the whole batch.
	 *
	 * @return list<array<string, string|null>>
	 */
	public function due( int $now, int $limit ): array {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE sync_status = %s AND next_attempt_at <= %d ORDER BY next_attempt_at ASC, id ASC LIMIT %d',
				$this->table(),
				SyncStatus::Pending->value,
				$now,
				$limit
			),
			ARRAY_A
		);

		/** @var list<array<string, string|null>>|null $rows ARRAY_A always keys by column name */
		return $rows ?? [];
	}

	/**
	 * Claims a due row for delivery: an UPDATE guarded by `id`, the row's current `next_attempt_at`,
	 * and `sync_status = 'pending'`. Returns true only when exactly one row changed.
	 *
	 * Callers must keep `$expected_next_attempt_at < $lease_until` (true whenever the caller got
	 * `$expected_next_attempt_at` from `due()`, which only returns rows with `next_attempt_at <=
	 * now`): a same-value UPDATE reports 0 rows changed even when the WHERE clause matched, so a
	 * coinciding expected value and lease would read as a failed claim.
	 */
	public function claim( int $id, int $expected_next_attempt_at, int $lease_until ): bool {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$changed = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET next_attempt_at = %d WHERE id = %d AND next_attempt_at = %d AND sync_status = %s',
				$this->table(),
				$lease_until,
				$id,
				$expected_next_attempt_at,
				SyncStatus::Pending->value
			)
		);

		return 1 === $changed;
	}

	/**
	 * Stores the result of a delivery attempt. The `where` also requires `sync_status = 'pending'`,
	 * so a worker holding a stale lease can never overwrite a row a faster, overlapping run already
	 * marked `sent`. A write that matches nothing (the guard failed) is silently skipped: the row
	 * keeps its existing lease, so cron retries it on its own next pass.
	 */
	public function apply_sync( int $id, SyncUpdate $update ): void {
		global $wpdb;

		$wpdb->update(
			$this->table(),
			[
				'sync_status'     => $update->status->value,
				'attempts'        => $update->attempts,
				'next_attempt_at' => $update->next_attempt_at,
				'last_error'      => $update->last_error,
				'sent_at'         => null === $update->sent_at ? null : gmdate( 'Y-m-d H:i:s', $update->sent_at ),
			],
			[
				'id'          => $id,
				'sync_status' => SyncStatus::Pending->value,
			],
			[ '%s', '%d', '%d', '%s', '%s' ],
			[ '%d', '%s' ]
		);
	}
}
