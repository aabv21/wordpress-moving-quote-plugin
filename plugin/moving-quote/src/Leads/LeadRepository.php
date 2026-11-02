<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Delivery\SyncUpdate;
use Chivabox\MovingQuote\Pricing\Estimate;
use ValueError;

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

	/**
	 * Every lead whose `email` matches `$email` exactly, newest first. The one lookup the
	 * WordPress personal-data exporter keys on. Skips a row `LeadRecord::from_row()` can't parse,
	 * the same way `page()` and `chunk_after()` do, instead of letting one bad row fatal the whole
	 * export request.
	 *
	 * @return list<LeadRecord>
	 */
	public function find_by_email( string $email ): array {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$rows = $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM %i WHERE email = %s ORDER BY created_at DESC, id DESC', $this->table(), $email ),
			ARRAY_A
		);

		/** @var list<array<string, string|null>>|null $rows ARRAY_A always keys by column name */
		return self::parseable_rows( $rows ?? [] );
	}

	/**
	 * Permanently deletes every lead row whose `email` matches `$email` exactly, in one statement.
	 * The WordPress personal-data eraser's own lookup: unlike `find_by_email()`, this never has to
	 * parse a row to delete it, so a row with an unparseable `status` (which `find_by_email()`
	 * would skip) is still erased. Returns the number of rows deleted.
	 */
	public function delete_by_email( string $email ): int {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$deleted = $wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE email = %s', $this->table(), $email ) );

		return false === $deleted ? 0 : $deleted;
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

	/**
	 * One page of leads, optionally filtered to one status, newest first (`created_at` DESC, `id`
	 * DESC as the tiebreak for two rows sharing a second). `$page` is 1-based.
	 *
	 * @return list<LeadRecord>
	 */
	public function page( ?LeadStatus $status, int $page, int $per_page ): array {
		global $wpdb;

		$offset = max( 0, $page - 1 ) * $per_page;

		if ( null === $status ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d',
					$this->table(),
					$per_page,
					$offset
				),
				ARRAY_A
			);
		} else {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE status = %s ORDER BY created_at DESC, id DESC LIMIT %d OFFSET %d',
					$this->table(),
					$status->value,
					$per_page,
					$offset
				),
				ARRAY_A
			);
		}

		/** @var list<array<string, string|null>>|null $rows ARRAY_A always keys by column name */
		return self::parseable_rows( $rows ?? [] );
	}

	/**
	 * The row count for every `LeadStatus`, including a status with zero rows, plus the total under
	 * `all`. One `GROUP BY` query, so adding a view never costs another round trip.
	 *
	 * @return array<string, int>
	 */
	public function count_by_status(): array {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$rows = $wpdb->get_results(
			$wpdb->prepare( 'SELECT status, COUNT(*) AS total FROM %i GROUP BY status', $this->table() ),
			ARRAY_A
		);

		$counts = [ 'all' => 0 ];
		foreach ( LeadStatus::cases() as $case ) {
			$counts[ $case->value ] = 0;
		}

		/** @var list<array{status: string, total: string}> $typed_rows ARRAY_A always keys by column name */
		$typed_rows = $rows ?? [];
		foreach ( $typed_rows as $row ) {
			$total                    = (int) $row['total'];
			$counts[ $row['status'] ] = $total;
			$counts['all']           += $total;
		}

		return $counts;
	}

	/** Sets a lead's lifecycle `status`. Returns true when a row with `$id` exists (even if the value didn't change). */
	public function update_status( int $id, LeadStatus $status ): bool {
		global $wpdb;

		$changed = $wpdb->update(
			$this->table(),
			[ 'status' => $status->value ],
			[ 'id' => $id ],
			[ '%s' ],
			[ '%d' ]
		);

		if ( false === $changed ) {
			return false;
		}

		return null !== $this->find( $id );
	}

	/**
	 * Requeues a `failed` lead for delivery: back to `pending`, attempts reset to 0, due
	 * immediately (`next_attempt_at = $now`). Only a `failed` row matches the guard, so retrying a
	 * lead that's already `pending` or `sent` is a no-op that changes nothing.
	 */
	public function requeue( int $id, int $now ): bool {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$changed = $wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET sync_status = %s, attempts = 0, next_attempt_at = %d, last_error = %s WHERE id = %d AND sync_status = %s',
				$this->table(),
				SyncStatus::Pending->value,
				$now,
				'',
				$id,
				SyncStatus::Failed->value
			)
		);

		return 1 === $changed;
	}

	/**
	 * Leads with `id > $after_id`, optionally filtered to one status, ascending by id, up to
	 * `$limit`. The CSV export's paging cursor: unlike `page()`'s `created_at` ordering (which can
	 * repeat or reorder as new rows arrive mid-export), an ascending, strictly-increasing id can
	 * only ever move forward, so a batch never re-reads or skips a row even if the table changes
	 * while the export is streaming.
	 *
	 * Returns the raw batch's own row count and last id alongside the parsed records: `records` can
	 * be shorter than `raw_count` when one or more rows in the batch were unparseable and skipped,
	 * and the caller must drive its "is there another batch?" loop from `raw_count`, not
	 * `count( records )` — otherwise a batch that happened to contain a bad row looks like the last,
	 * short page of results and the export stops early, silently dropping every good row after it.
	 * `last_raw_id` (not necessarily a parsed record's own id) is what the caller's cursor must
	 * advance to, so a skipped row at the end of a batch is never re-fetched on the next call.
	 *
	 * @return array{records: list<LeadRecord>, raw_count: int, last_raw_id: int}
	 */
	public function chunk_after( ?LeadStatus $status, int $after_id, int $limit ): array {
		global $wpdb;

		if ( null === $status ) {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE id > %d ORDER BY id ASC LIMIT %d',
					$this->table(),
					$after_id,
					$limit
				),
				ARRAY_A
			);
		} else {
			// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE id > %d AND status = %s ORDER BY id ASC LIMIT %d',
					$this->table(),
					$after_id,
					$status->value,
					$limit
				),
				ARRAY_A
			);
		}

		/** @var list<array<string, string|null>>|null $rows ARRAY_A always keys by column name */
		$raw_rows = $rows ?? [];
		$last_row = $raw_rows[ count( $raw_rows ) - 1 ] ?? null;

		return [
			'records'     => self::parseable_rows( $raw_rows ),
			'raw_count'   => count( $raw_rows ),
			'last_raw_id' => null === $last_row ? $after_id : (int) $last_row['id'],
		];
	}

	/**
	 * How many leads look stuck: every `failed` row, plus every `pending` row whose `created_at`
	 * (stored UTC) is older than `$stale_before` (a Unix timestamp). A lead the team has already
	 * closed out (`won` or `lost`) no longer counts, even if its own delivery never finished —
	 * resolving the lead resolves the notice too.
	 */
	public function count_stuck( int $stale_before ): int {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$count = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE status NOT IN ( %s, %s ) AND ( sync_status = %s OR ( sync_status = %s AND created_at < %s ) )',
				$this->table(),
				LeadStatus::Won->value,
				LeadStatus::Lost->value,
				SyncStatus::Failed->value,
				SyncStatus::Pending->value,
				gmdate( 'Y-m-d H:i:s', $stale_before )
			)
		);

		return (int) $count;
	}

	/** Permanently deletes one lead row. A missing id is a no-op. */
	public function delete( int $id ): void {
		global $wpdb;

		$wpdb->delete( $this->table(), [ 'id' => $id ], [ '%d' ] );
	}

	/**
	 * Converts every row to a `LeadRecord`, skipping any row `LeadRecord::from_row()` can't parse
	 * (most likely an unknown `status` value written by a different plugin version) instead of
	 * letting that one row fatal the whole admin Leads page or CSV export, the same way
	 * `Delivery\Outbox::process_due()` already skips a poison row rather than losing the rest of
	 * its batch behind it.
	 *
	 * @param list<array<string, string|null>> $rows
	 * @return list<LeadRecord>
	 */
	private static function parseable_rows( array $rows ): array {
		$records = [];
		foreach ( $rows as $row ) {
			try {
				$records[] = LeadRecord::from_row( $row );
			} catch ( ValueError ) {
				continue;
			}
		}
		return $records;
	}
}
