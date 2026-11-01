<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

use Chivabox\MovingQuote\Leads\SyncStatus;

/** The result of one delivery attempt, ready to be stored on the lead row. */
final readonly class SyncUpdate {
	public function __construct(
		public SyncStatus $status,
		public int $attempts,
		public int $next_attempt_at,
		public string $last_error,
		public ?int $sent_at
	) {
	}
}
