<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Security;

/**
 * Fixed-window limits in transients under a hashed key, so no IP reaches the database.
 *
 * Without an object cache a transient is a `wp_options` row, so a concurrent burst could all read
 * the same stale count. `hit()` holds a MySQL named lock on the bucket key for its read-check-write.
 */
final class RateLimiter {
	private const TRANSIENT_PREFIX            = 'moving_quote_rl_';
	private const HASH_LENGTH                 = 20;
	private const LOCK_TIMEOUT_S              = 2;
	private const LOCK_FAILED_WAIT            = 2;
	public const RATE_LIMITED_COUNT_TRANSIENT = 'moving_quote_rate_limited_submissions';
	public const RATE_LIMITED_COUNT_WINDOW    = DAY_IN_SECONDS;

	/**
	 * Returns 0 when allowed (and counted), otherwise the seconds until the window resets.
	 *
	 * Fails closed: if the lock times out or errors, answers as rate-limited with a short wait
	 * rather than let an uncounted hit through.
	 */
	public function hit( string $bucket, int $limit, int $window_seconds ): int {
		$key = $this->transient_key( $bucket );

		if ( ! self::acquire_lock( $key ) ) {
			return self::LOCK_FAILED_WAIT;
		}

		try {
			return $this->count_hit( $key, $limit, $window_seconds );
		} finally {
			self::release_lock( $key );
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

	private static function acquire_lock( string $key ): bool {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session-scoped advisory lock, not a data query; no caching wrapper applies.
		$result = $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $key, self::LOCK_TIMEOUT_S ) );
		// MySQL answers '1' when the lock is granted ('0' on timeout, NULL on error). WordPress
		// Playground's SQLite translator has no lock to take and answers '1=1'. Only those two
		// count as granted, so any other value still fails closed.
		return '1' === $result || '1=1' === $result;
	}

	private static function release_lock( string $key ): void {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session-scoped advisory lock, not a data query; no caching wrapper applies.
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $key ) );
	}

	/**
	 * Counts one rate-limited `submit` for `StuckDeliveryNotice`: a count and a reset time only,
	 * never an IP or other per-visitor data.
	 *
	 * The 24 h window is fixed, not rolling: it starts at the first 429 and later 429s never move
	 * `reset`, so bursts in two consecutive windows are never summed.
	 *
	 * Guarded by the same named lock as `hit()`. If the lock fails, this 429 goes uncounted: that
	 * only understates the notice, never the limit itself.
	 */
	public static function record_rate_limited_submission(): void {
		if ( ! self::acquire_lock( self::RATE_LIMITED_COUNT_TRANSIENT ) ) {
			return;
		}

		try {
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
		} finally {
			self::release_lock( self::RATE_LIMITED_COUNT_TRANSIENT );
		}
	}

	/** In the current fixed window; see `record_rate_limited_submission()`. */
	public static function rate_limited_submission_count(): int {
		$data = get_transient( self::RATE_LIMITED_COUNT_TRANSIENT );
		if ( ! is_array( $data ) || ! isset( $data['count'] ) || ! is_int( $data['count'] ) ) {
			return 0;
		}
		return $data['count'];
	}

	/** Filterable through `moving_quote_client_ip` for a site behind a trusted proxy. */
	public function client_ip(): string {
		$remote_addr = $_SERVER['REMOTE_ADDR'] ?? null;
		$ip          = is_string( $remote_addr ) ? sanitize_text_field( wp_unslash( $remote_addr ) ) : '';
		/** @var string $filtered */
		$filtered = apply_filters( 'moving_quote_client_ip', $ip );
		return $filtered;
	}

	private function transient_key( string $bucket ): string {
		$hash = hash_hmac( 'sha256', self::normalize_ip( $this->client_ip() ), wp_salt( 'nonce' ) );
		return self::TRANSIENT_PREFIX . $bucket . '_' . substr( $hash, 0, self::HASH_LENGTH );
	}

	/**
	 * Zeroes the last 64 bits of an IPv6 address, so one visitor's /64 (commonly one ISP
	 * assignment) shares a bucket instead of minting a fresh budget per address. IPv4, IPv4-mapped
	 * IPv6, and anything unparseable are returned unchanged.
	 */
	public static function normalize_ip( string $ip ): string {
		$binary = inet_pton( $ip );
		if ( false === $binary || 16 !== strlen( $binary ) ) {
			// IPv4 packs into 4 bytes, not 16.
			return $ip;
		}

		if ( false !== filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 ) ) {
			return $ip; // Unreachable (IPv4 returned above); a defensive no-op.
		}

		// ::ffff:a.b.c.d is an IPv4 client with no /64 of its own.
		if ( str_starts_with( $binary, "\0\0\0\0\0\0\0\0\0\0\xff\xff" ) ) {
			return $ip;
		}

		$prefix    = substr( $binary, 0, 8 ) . str_repeat( "\0", 8 );
		$collapsed = inet_ntop( $prefix );
		return false !== $collapsed ? $collapsed : $ip;
	}
}
