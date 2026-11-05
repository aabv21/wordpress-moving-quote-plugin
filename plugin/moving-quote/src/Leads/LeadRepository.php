<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Delivery\SyncUpdate;
use Chivabox\MovingQuote\Pricing\Estimate;
use ValueError;

/**
 * Reads and writes the leads table directly, uncached: the admin list and the outbox always need
 * the latest state.
 */
final class LeadRepository {
	public function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'moving_quote_leads';
	}

	/**
	 * Returns the inserted row, or null when `request_uuid` already exists (the unique index makes a
	 * duplicate submission safe to retry). Any other failure throws `RuntimeException`, so a
	 * database error is never mistaken for a duplicate.
	 */
	public function insert( LeadDraft $draft, Estimate $estimate, int $now, int $next_attempt_at, string $locale = '' ): ?LeadRecord {
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
				'locale'            => $locale,
			],
			[ '%s', '%s', '%s', '%s', '%d', '%s', '%s', '%d', '%s', '%s', '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%s', '%d', '%d', '%s', '%s', '%s' ]
		);
		$wpdb->suppress_errors( $previous_suppress );

		if ( false !== $inserted ) {
			return $this->find_by_uuid( $draft->submission_id );
		}

		$existing = $this->find_by_uuid( $draft->submission_id );
		if ( null !== $existing ) {
			return null;
		}

		// NOTE: $wpdb->last_error carries no PII only while no unique or check constraint covers
		// phone or email; such a constraint could echo the rejected value, so revisit this then.
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
	 * Every lead with this exact `email`, newest first, for the personal-data exporter. Skips an
	 * unparseable row, like `page()` and `chunk_after()`.
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
	 * Every `request_uuid` for this exact `email`, newest first, whether or not its `status`
	 * parses. The eraser reads these before deleting, to name the copies it can't reach (the
	 * sheet row, the sent emails, a failed n8n execution).
	 *
	 * @return list<string>
	 */
	public function uuids_by_email( string $email ): array {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$uuids = $wpdb->get_col( $wpdb->prepare( 'SELECT request_uuid FROM %i WHERE email = %s ORDER BY created_at DESC, id DESC', $this->table(), $email ) );

		/** @var list<string> $uuids get_col() returns a plain list of column values */
		return $uuids;
	}

	/**
	 * Deletes every row with this exact `email` in one statement and returns the count. It never
	 * parses a row, so one with an unparseable `status` is still erased.
	 */
	public function delete_by_email( string $email ): int {
		global $wpdb;

		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- %i interpolates the table name inside prepare() itself.
		$deleted = $wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE email = %s', $this->table(), $email ) );

		return false === $deleted ? 0 : $deleted;
	}

	private static function typed_row( mixed $row ): ?LeadRecord {
		if ( ! is_array( $row ) ) {
			return null;
		}
		/** @var array<string, string|null> $row ARRAY_A always keys by column name */
		return LeadRecord::from_row( $row );
	}

	/**
	 * Pending rows with `next_attempt_at <= $now`, oldest first. Returned raw, not as `LeadRecord`,
	 * so a row with an unknown `status` still reaches the caller, which records the failure and
	 * moves on instead of losing the batch.
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
	 * Claims a due row: an UPDATE guarded by `id`, the current `next_attempt_at`, and
	 * `sync_status = 'pending'`. True only when exactly one row changed.
	 *
	 * Callers must keep `$expected_next_attempt_at < $lease_until` (always true for a row from
	 * `due()`): a same-value UPDATE reports 0 rows changed, which would read as a failed claim.
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
	 * Stores a delivery attempt's result, only while `sync_status = 'pending'`, so a stale-lease
	 * worker never overwrites a row another run marked `sent`. A write that matches nothing is
	 * skipped; the row keeps its lease and cron retries it.
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
	 * Newest first (`created_at` DESC, then `id` DESC). `$page` is 1-based.
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
	 * The count for every `LeadStatus` (zero included) plus `all`, from one `GROUP BY` query.
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

	/** True when a row with `$id` exists, even if the value didn't change. */
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
	 * Moves a `failed` lead back to `pending`, 0 attempts, due now. Any other row is a no-op.
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
	 * Leads with `id > $after_id`, ascending by id: the CSV export's cursor. Unlike `page()`'s
	 * `created_at` order, an id cursor never re-reads or skips a row added mid-export.
	 *
	 * `records` can be shorter than `raw_count` when unparseable rows were skipped. Callers loop on
	 * `raw_count`, not `count( records )`, or a batch with a bad row ends the export early, and
	 * advance the cursor to `last_raw_id`, so a skipped last row is never re-fetched.
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
	 * Every `failed` row plus every `pending` row created (UTC) before `$stale_before`, excluding
	 * leads already `won` or `lost`: closing the lead resolves the notice too.
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

	/** A missing id is a no-op. */
	public function delete( int $id ): void {
		global $wpdb;

		$wpdb->delete( $this->table(), [ 'id' => $id ], [ '%d' ] );
	}

	/**
	 * Skips a row `LeadRecord::from_row()` can't parse (most likely a `status` from another plugin
	 * version), so one bad row never fatals the Leads page or the CSV export.
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
