<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Security;

/**
 * A fixed-window rate limiter keyed by client IP, stored in transients under a hashed key so the
 * IP itself never appears in the database.
 *
 * Without a persistent object cache, a transient is just a row in `wp_options`: a concurrent
 * burst of requests can all read the same stale count before any of them writes the incremented
 * value back, undercounting the hits. `hit()` closes that window with a MySQL named lock on the
 * same hashed bucket key, so only one request at a time runs the read-check-write sequence for a
 * given bucket.
 */
final class RateLimiter {
	private const TRANSIENT_PREFIX            = 'moving_quote_rl_';
	private const HASH_LENGTH                 = 20;
	private const LOCK_TIMEOUT_S              = 2;
	private const LOCK_FAILED_WAIT            = 2;
	public const RATE_LIMITED_COUNT_TRANSIENT = 'moving_quote_rate_limited_submissions';
	public const RATE_LIMITED_COUNT_WINDOW    = DAY_IN_SECONDS;

	/**
	 * Counts one hit against `$bucket` for the current client. Returns 0 when the request is
	 * allowed (and counted), otherwise the number of seconds until the window resets (and the hit
	 * is not counted again).
	 *
	 * Fails closed: if the named lock can't be acquired within the timeout — another request is
	 * already updating this exact bucket, or the lock call itself errors — this answers as if the
	 * limit were hit, with a short wait, rather than risk an uncounted hit slipping through.
	 */
	public function hit( string $bucket, int $limit, int $window_seconds ): int {
		$key = $this->transient_key( $bucket );

		if ( ! $this->acquire_lock( $key ) ) {
			return self::LOCK_FAILED_WAIT;
		}

		try {
			return $this->count_hit( $key, $limit, $window_seconds );
		} finally {
			$this->release_lock( $key );
		}
	}

	private function count_hit( string $key, int $limit, int $window_seconds ): int {
		$now  = time();
		$data = get_transient( $key );

		if ( ! is_array( $data ) || ! isset( $data['count'], $data['reset'] ) || ! is_int( $data['count'] ) || ! is_int( $data['reset'] ) || $data['reset'] <= $now ) {
			set_transient(
				$key,
				[
					'count' => 1,
					'reset' => $now + $window_seconds,
				],
				$window_seconds
			);
			return 0;
		}

		if ( $data['count'] >= $limit ) {
			return $data['reset'] - $now;
		}

		set_transient(
			$key,
			[
				'count' => $data['count'] + 1,
				'reset' => $data['reset'],
			],
			$data['reset'] - $now
		);
		return 0;
	}

	/** True once `GET_LOCK()` reports success (`1`); false on a timeout (`0`) or an error (`NULL`). */
	private function acquire_lock( string $key ): bool {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session-scoped advisory lock, not a data query; no caching wrapper applies.
		$result = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $key, self::LOCK_TIMEOUT_S ) );
		// MySQL answers '1' when the lock is granted ('0' on timeout, NULL on error). WordPress
		// Playground's SQLite translator has no lock to take and answers '1=1'. Only those two
		// count as granted, so any other value still fails closed.
		return '1' === $result || '1=1' === $result;
	}

	private function release_lock( string $key ): void {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session-scoped advisory lock, not a data query; no caching wrapper applies.
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $key ) );
	}

	/**
	 * Counts one `submit` request that was rejected for being rate-limited. Holds only a count and
	 * a reset time in a single transient (`RATE_LIMITED_COUNT_TRANSIENT`) — never an IP address or
	 * any other per-visitor data — so `StuckDeliveryNotice` can tell the site owner how many
	 * submissions were rate-limited without identifying any of them.
	 *
	 * The window is fixed, not rolling: it starts at the first 429 after the transient expired or
	 * was empty, and runs for a flat `RATE_LIMITED_COUNT_WINDOW` (24 h) from that moment, during
	 * which every further 429 only increments `count` without moving `reset`. A burst at hour 23
	 * of one window and another at hour 1 of the next are both counted, but never summed into one
	 * "last 24 hours" figure the way a true rolling window would.
	 */
	public static function record_rate_limited_submission(): void {
		$now  = time();
		$data = get_transient( self::RATE_LIMITED_COUNT_TRANSIENT );

		if ( ! is_array( $data ) || ! isset( $data['count'], $data['reset'] ) || ! is_int( $data['count'] ) || ! is_int( $data['reset'] ) || $data['reset'] <= $now ) {
			set_transient(
				self::RATE_LIMITED_COUNT_TRANSIENT,
				[
					'count' => 1,
					'reset' => $now + self::RATE_LIMITED_COUNT_WINDOW,
				],
				self::RATE_LIMITED_COUNT_WINDOW
			);
			return;
		}

		set_transient(
			self::RATE_LIMITED_COUNT_TRANSIENT,
			[
				'count' => $data['count'] + 1,
				'reset' => $data['reset'],
			],
			$data['reset'] - $now
		);
	}

	/** How many `submit` requests were rejected as rate-limited in the current fixed 24-hour window (see `record_rate_limited_submission()`). */
	public static function rate_limited_submission_count(): int {
		$data = get_transient( self::RATE_LIMITED_COUNT_TRANSIENT );
		if ( ! is_array( $data ) || ! isset( $data['count'] ) || ! is_int( $data['count'] ) ) {
			return 0;
		}
		return $data['count'];
	}

	/** The current request's client IP, filterable for use behind a trusted proxy. */
	public function client_ip(): string {
		$remote_addr = $_SERVER['REMOTE_ADDR'] ?? null;
		$ip          = is_string( $remote_addr ) ? sanitize_text_field( wp_unslash( $remote_addr ) ) : '';
		/** @var string $filtered */
		$filtered = apply_filters( 'moving_quote_client_ip', $ip );
		return $filtered;
	}

	private function transient_key( string $bucket ): string {
		$hash = hash_hmac( 'sha256', $this->client_ip(), wp_salt( 'nonce' ) );
		return self::TRANSIENT_PREFIX . $bucket . '_' . substr( $hash, 0, self::HASH_LENGTH );
	}
}
