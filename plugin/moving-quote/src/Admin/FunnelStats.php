<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

/**
 * The three numbers above the Leads list. The win rate is won over closed leads (won plus lost),
 * not over every lead, so an open pipeline doesn't drag it down.
 */
final readonly class FunnelStats {
	public function __construct(
		public int $last_7_days,
		public int $won,
		public ?int $win_rate_percent
	) {
	}

	/** @param array<string, int> $by_status the count per status value, as `count_by_status()` returns it */
	public static function from( array $by_status, int $last_7_days ): self {
		$won    = $by_status['won'] ?? 0;
		$closed = $won + ( $by_status['lost'] ?? 0 );

		return new self( $last_7_days, $won, 0 === $closed ? null : (int) round( 100 * $won / $closed ) );
	}
}
