<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Delivery;

use Chivabox\MovingQuote\Delivery\LeadPayload;
use Chivabox\MovingQuote\Leads\LeadRecord;
use Chivabox\MovingQuote\Tests\Fixtures;
use PHPUnit\Framework\TestCase;

final class LeadPayloadTest extends TestCase {
	public function test_body_matches_the_shared_contract_fixture(): void {
		$body = LeadPayload::body( LeadRecord::from_row( Fixtures::lead_row() ), 'Chivabox Movers', 'team@example.com', new \DateTimeZone( 'America/Bogota' ) );
		self::assertSame( trim( (string) file_get_contents( dirname( __DIR__, 2 ) . '/fixtures/lead-payload.json' ) ), $body );
	}

	/** `exp` 1793801100 is 300 seconds after `iat` 1793800800, pinning TTL_SECONDS without a separate case. */
	public function test_claims_bind_the_body(): void {
		self::assertSame(
			[ 'jti' => '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b', 'iat' => 1793800800, 'exp' => 1793801100, 'body_sha256' => 'b611ccfc557777d18b13a1a3537dc846c3a81c9828924fdd2856ec71da2c13df' ],
			LeadPayload::claims( '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b', '{"request_uuid":"6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b"}', 1793800800 )
		);
	}
}
