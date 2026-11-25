<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Admin;

use Chivabox\MovingQuote\Admin\FunnelStats;
use PHPUnit\Framework\TestCase;

final class FunnelStatsTest extends TestCase {
	public function test_win_rate_is_won_over_closed_leads(): void {
		$stats = FunnelStats::from( [ 'won' => 3, 'lost' => 1, 'new' => 9 ], 4 );

		self::assertSame( 4, $stats->last_7_days );
		self::assertSame( 3, $stats->won );
		self::assertSame( 75, $stats->win_rate_percent );
	}

	public function test_no_closed_leads_gives_no_rate(): void {
		$stats = FunnelStats::from( [ 'new' => 2, 'contacted' => 1 ], 3 );

		self::assertSame( 0, $stats->won );
		self::assertNull( $stats->win_rate_percent );
	}

	public function test_the_rate_rounds_to_a_whole_percent(): void {
		self::assertSame( 67, FunnelStats::from( [ 'won' => 2, 'lost' => 1 ], 0 )->win_rate_percent );
		self::assertSame( 0, FunnelStats::from( [ 'lost' => 4 ], 0 )->win_rate_percent );
	}
}
