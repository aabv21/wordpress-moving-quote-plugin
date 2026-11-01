<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Delivery;

use Chivabox\MovingQuote\Delivery\ResponseCheck;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ResponseCheckTest extends TestCase {
	#[DataProvider( 'responses' )]
	public function test_acknowledged( int $status, string $body, bool $expected ): void {
		self::assertSame( $expected, ResponseCheck::acknowledged( $status, $body ) );
	}

	/** @return iterable<string, array{int, string, bool}> */
	public static function responses(): iterable {
		return [
			'200 accepted'                 => [ 200, '{"status":"accepted"}', true ],
			'200 duplicate'                => [ 200, '{"status":"duplicate"}', true ],
			'201 accepted'                 => [ 201, '{"status":"accepted"}', true ],
			'200 non-JSON body'            => [ 200, '<html>ok</html>', false ],
			'200 rejected'                 => [ 200, '{"status":"rejected"}', false ],
			'401 rejected with a reason'   => [ 401, '{"status":"rejected","reason":"body_hash_mismatch"}', false ],
			'500 empty body'               => [ 500, '', false ],
		];
	}
}
