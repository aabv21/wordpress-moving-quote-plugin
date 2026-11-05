<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

use Chivabox\MovingQuote\Leads\SyncStatus;

final class SyncTransition {
	private const ERROR_MAX_LENGTH = 500;

	public static function after_attempt( int $attempts_before, bool $succeeded, string $error, int $now ): SyncUpdate {
		$attempts = $attempts_before + 1;

		if ( $succeeded ) {
			return new SyncUpdate( SyncStatus::Sent, $attempts, 0, '', $now );
		}

		$trimmed_error = mb_substr( $error, 0, self::ERROR_MAX_LENGTH );

		if ( $attempts >= Backoff::MAX_ATTEMPTS ) {
			return new SyncUpdate( SyncStatus::Failed, $attempts, 0, $trimmed_error, null );
		}

		return new SyncUpdate( SyncStatus::Pending, $attempts, $now + Backoff::delay_after( $attempts ), $trimmed_error, null );
	}
}
