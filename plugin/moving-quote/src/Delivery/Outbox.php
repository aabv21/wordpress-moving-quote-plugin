<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

use Chivabox\MovingQuote\Leads\{LeadRecord, LeadRepository};
use Chivabox\MovingQuote\Settings\Options;
use DateTimeZone;
use Throwable;
use ValueError;

/**
 * At-least-once: n8n dedupes on `jti`, and `apply_sync()`'s `pending` guard keeps a `sent` row
 * `sent`. `process_due()` claims each row with a lease first; the inline attempt skips the claim
 * because `insert()` already set `next_attempt_at = now + LEASE_SECONDS`.
 *
 * NOTE: a runner stalled past its lease can be overtaken, and its late write can mask the second
 * runner's outcome, since `apply_sync()` checks only `sync_status`. Upgrade path: fence
 * `apply_sync()` on the lease value `claim()` issued.
 */
final class Outbox {
	public const LEASE_SECONDS = 120;
	public const BATCH_SIZE    = 20;

	public static function deliver( LeadRecord $lead ): SyncUpdate {
		$now = time();

		try {
			// blogname is stored entity-encoded (`&amp;`, `&#039;`); the payload needs real characters.
			$site_name = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );
			$body      = LeadPayload::body( $lead, $site_name, Options::team_email(), new DateTimeZone( 'America/Bogota' ) );
			$claims    = LeadPayload::claims( $lead->request_uuid, $body, $now );
			$jwt       = JwtSigner::hs256( $claims, Options::webhook_secret() );

			$error  = WebhookClient::send( Options::webhook_url(), $jwt, $body );
			$update = SyncTransition::after_attempt( $lead->attempts, null === $error, $error ?? '', $now );
		} catch ( Throwable $e ) {
			// Counts as an attempt, so a persistent fault backs off to `failed`. Only the class is
			// recorded: the message could carry the lead's PII.
			$update = SyncTransition::after_attempt( $lead->attempts, false, 'Internal error: ' . get_class( $e ), $now );
		}

		( new LeadRepository() )->apply_sync( $lead->id, $update );
		return $update;
	}

	/** Returns 0 without querying when delivery is off. */
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
				// An unparseable row (likely another version's status) counts as a failed attempt,
				// like a Throwable in deliver(), and never blocks the rest of the batch.
				self::record_poison_row( $repository, $row, $e );
				continue;
			}

			// Lease from claim time, not batch start, so a slow batch never claims with a spent lease.
			if ( ! $repository->claim( $lead->id, $lead->next_attempt_at, time() + self::LEASE_SECONDS ) ) {
				// Claimed by another run, or no longer pending.
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
