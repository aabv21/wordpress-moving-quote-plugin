<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Delivery;

use Chivabox\MovingQuote\Delivery\Backoff;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class BackoffTest extends TestCase {
	#[DataProvider( 'failed_attempts' )]
	public function test_delay_after( int $failed_attempts, int $expected_seconds ): void {
		self::assertSame( $expected_seconds, Backoff::delay_after( $failed_attempts ) );
	}

	/** @return iterable<string, array{int, int}> */
	public static function failed_attempts(): iterable {
		return [
			'1st failure'                => [ 1, 60 ],
			'2nd failure'                => [ 2, 120 ],
			'5th failure'                => [ 5, 960 ],
			'9th failure'                => [ 9, 15360 ],
			'10th failure, reaches cap'  => [ 10, 21600 ],
			'far beyond max, stays capped' => [ 100, 21600 ],
			'a value below 1 treated as 1' => [ 0, 60 ],
		];
	}
}
