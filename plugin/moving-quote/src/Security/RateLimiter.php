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
	private const TRANSIENT_PREFIX = 'moving_quote_rl_';
	private const HASH_LENGTH      = 20;
	private const LOCK_TIMEOUT_S   = 2;
	private const LOCK_FAILED_WAIT = 2;

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
		return '1' === $result;
	}

	private function release_lock( string $key ): void {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session-scoped advisory lock, not a data query; no caching wrapper applies.
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $key ) );
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
