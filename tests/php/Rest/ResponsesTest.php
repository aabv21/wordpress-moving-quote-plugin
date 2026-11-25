<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Rest;

use Chivabox\MovingQuote\Pricing\Estimate;
use Chivabox\MovingQuote\Rest\Responses;
use PHPUnit\Framework\TestCase;

final class ResponsesTest extends TestCase {
	public function test_estimate_body_has_the_documented_shape(): void {
		$body = Responses::estimate_body( new Estimate( 1130000, 1017000, 1243000, 415 ), 'COP 1,017,000 – 1,243,000' );

		self::assertSame( [ 'amount', 'low', 'high', 'distance_km', 'currency', 'display' ], array_keys( $body ) );
		self::assertSame( 1130000, $body['amount'] );
		self::assertSame( 1017000, $body['low'] );
		self::assertSame( 1243000, $body['high'] );
		self::assertSame( 415, $body['distance_km'] );
		self::assertSame( 'COP', $body['currency'] );
		self::assertSame( 'COP 1,017,000 – 1,243,000', $body['display'] );
	}
}
