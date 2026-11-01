<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

/** The outbox's retry schedule: exponential backoff capped at `CAP_SECONDS`, giving up after `MAX_ATTEMPTS`. */
final class Backoff {
	public const MAX_ATTEMPTS = 10;
	public const BASE_SECONDS = 60;
	public const CAP_SECONDS  = 21_600;

	/**
	 * Seconds to wait before the next attempt, after `$failed_attempts` failures so far. A value
	 * below 1 is treated as 1, so a caller never has to guard a zero or negative input. The cap is
	 * checked before the multiplication (not after), so a large `$failed_attempts` never overflows
	 * `2 ** ($failed_attempts - 1)` on its way to being capped anyway.
	 */
	public static function delay_after( int $failed_attempts ): int {
		$attempts = max( 1, $failed_attempts );
		if ( $attempts >= self::MAX_ATTEMPTS ) {
			return self::CAP_SECONDS;
		}

		return min( self::BASE_SECONDS * 2 ** ( $attempts - 1 ), self::CAP_SECONDS );
	}
}
