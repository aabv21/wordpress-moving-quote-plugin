<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

/** The outbox's retry schedule: exponential backoff capped at `CAP_SECONDS`, giving up after `MAX_ATTEMPTS`. */
final class Backoff {
	public const MAX_ATTEMPTS = 10;
	public const BASE_SECONDS = 60;
	public const CAP_SECONDS  = 21_600;

	/**
	 * A value below 1 reads as 1. The cap is checked before multiplying, so a large input never
	 * overflows `2 ** ($failed_attempts - 1)`.
	 */
	public static function delay_after( int $failed_attempts ): int {
		$attempts = max( 1, $failed_attempts );
		if ( $attempts >= self::MAX_ATTEMPTS ) {
			return self::CAP_SECONDS;
		}

		return min( self::BASE_SECONDS * 2 ** ( $attempts - 1 ), self::CAP_SECONDS );
	}
}
