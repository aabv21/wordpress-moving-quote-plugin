<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

use Chivabox\MovingQuote\Leads\{LeadRecord, LeadRepository};
use Chivabox\MovingQuote\Settings\Options;
use DateTimeZone;
use Throwable;
use ValueError;

/**
 * Delivers a lead to n8n and records the outcome. Delivery is at-least-once, not exactly-once:
 * n8n dedupes on `jti` (= `request_uuid`), and `apply_sync()`'s `pending` guard keeps an
 * already-`sent` row `sent`. `process_due()` is the cron entry point: it claims each due row with
 * a lease before delivering it, so two overlapping runs don't normally deliver the same lead
 * twice. The inline attempt right after a new insert calls `deliver()` directly instead, with no
 * claim of its own, since `insert()` already sets `next_attempt_at = now + LEASE_SECONDS`, so no
 * cron run can see the row as due until that lease expires.
 *
 * NOTE: a runner stalled past its own lease can be overtaken by a second runner, which claims and
 * delivers the row; if that second runner then fails and the row goes back to `pending`, the
 * first runner's own late write can still land and mask the second runner's outcome, since
 * `apply_sync()` only checks `sync_status`, not which lease issued the write. The fix is fencing
 * `apply_sync()` on the lease value `claim()` issued, not just on `sync_status = 'pending'`.
 */
final class Outbox {
	public const LEASE_SECONDS = 120;
	public const BATCH_SIZE    = 20;

	/** Builds the signed request, sends it, applies the resulting `SyncTransition`, and stores it. */
	public static function deliver( LeadRecord $lead ): SyncUpdate {
		$now = time();

		try {
			// blogname is stored entity-encoded (e.g. "Chivabox & Sons' Movers" as `&amp;`/`&#039;`);
			// the payload must carry the real characters, not HTML entities.
			$site_name = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
			$body      = LeadPayload::body( $lead, $site_name, Options::team_email(), new DateTimeZone( 'America/Bogota' ) );
			$claims    = LeadPayload::claims( $lead->request_uuid, $body, $now );
			$jwt       = JwtSigner::hs256( $claims, Options::webhook_secret() );

			$error  = WebhookClient::send( Options::webhook_url(), $jwt, $body );
			$update = SyncTransition::after_attempt( $lead->attempts, null === $error, $error ?? '', $now );
		} catch ( Throwable $e ) {
			// Every internal failure still counts as an attempt, so a persistent fault backs off and
			// eventually reaches `failed` instead of retrying forever. Only the exception class is
			// recorded: its message could carry PII pulled from the lead itself.
			$update = SyncTransition::after_attempt( $lead->attempts, false, 'Internal error: ' . get_class( $e ), $now );
		}

		( new LeadRepository() )->apply_sync( $lead->id, $update );
		return $update;
	}

	/** Delivers every currently due, successfully claimed lead, one batch at a time. Returns 0 without querying when delivery is off. */
	public static function process_due(): int {
		if ( ! Options::delivery_enabled() ) {
			return 0;
		}

		$repository = new LeadRepository();
		$rows       = $repository->due( time(), self::BATCH_SIZE );
		$delivered  = 0;

		foreach ( $rows as $row ) {
			try {
				$lead = LeadRecord::from_row( $row );
			} catch ( ValueError $e ) {
				// A row this plugin version can't parse (most likely an unknown status written by a
				// different version) must not block every other due lead behind it in the batch.
				// Record the same attempt-counting failure path a caught Throwable in deliver() would,
				// using the row's own stored attempts, and move on to the next row.
				self::record_poison_row( $repository, $row, $e );
				continue;
			}

			// Each row's lease is counted from the moment it's claimed, not from when the batch
			// started: a slow batch never claims a later row with a lease that's already partly (or
			// fully) spent.
			if ( ! $repository->claim( $lead->id, $lead->next_attempt_at, time() + self::LEASE_SECONDS ) ) {
				// Already claimed by another run (including the cron sidecar's own background loop)
				// or no longer pending; it was never this run's row to deliver.
				continue;
			}

			self::deliver( $lead );
			++$delivered;
		}

		return $delivered;
	}

	/** @param array<string, string|null> $row a raw due() row that LeadRecord::from_row() rejected */
	private static function record_poison_row( LeadRepository $repository, array $row, ValueError $e ): void {
		$id       = (int) $row['id'];
		$attempts = (int) $row['attempts'];
		$update   = SyncTransition::after_attempt( $attempts, false, 'Internal error: ' . get_class( $e ), time() );
		$repository->apply_sync( $id, $update );
	}
}
