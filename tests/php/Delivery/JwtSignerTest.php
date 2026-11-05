<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Delivery;

use Chivabox\MovingQuote\Delivery\JwtSigner;
use PHPUnit\Framework\TestCase;

final class JwtSignerTest extends TestCase {
	/**
	 * Computed independently with Node's crypto; it also pins unpadded base64url and header order.
	 */
	public function test_signs_the_reference_vector(): void {
		$token = JwtSigner::hs256(
			[ 'jti' => '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b', 'iat' => 1793800800, 'exp' => 1793801100, 'body_sha256' => 'b611ccfc557777d18b13a1a3537dc846c3a81c9828924fdd2856ec71da2c13df' ],
			'unit-test-secret-not-used-anywhere-else-0001'
		);
		self::assertSame(
			[
				'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
				'eyJqdGkiOiI2ZjFjMmE5ZS0zYjRkLTRlOGYtOWExYi0yYzNkNGU1ZjZhN2IiLCJpYXQiOjE3OTM4MDA4MDAsImV4cCI6MTc5MzgwMTEwMCwiYm9keV9zaGEyNTYiOiJiNjExY2NmYzU1Nzc3N2QxOGIxM2ExYTM1MzdkYzg0NmMzYTgxYzk4Mjg5MjRmZGQyODU2ZWM3MWRhMmMxM2RmIn0',
				'h6V0yFjhtfRvR28GPY3C83cdCrw_erUZInZIkmjuD48',
			],
			explode( '.', $token )
		);
	}
}
