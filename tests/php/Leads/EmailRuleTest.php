<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Leads;

use Chivabox\MovingQuote\Leads\EmailRule;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * `tests/nodes/email-rule-parity.test.ts` runs `isSimpleEmail()` over the same file.
 */
final class EmailRuleTest extends TestCase {
	/** @return iterable<string, array{string, bool}> */
	public static function shared_cases(): iterable {
		$json = file_get_contents( __DIR__ . '/../../fixtures/email-cases.json' );
		self::assertIsString( $json );
		$cases = json_decode( $json, true, 512, JSON_THROW_ON_ERROR );
		self::assertIsArray( $cases );
		foreach ( $cases as $case ) {
			self::assertIsArray( $case );
			self::assertIsString( $case['address'] );
			self::assertIsBool( $case['valid'] );
			yield json_encode( $case['address'], JSON_THROW_ON_ERROR ) => [ $case['address'], $case['valid'] ];
		}
	}

	#[DataProvider( 'shared_cases' )]
	public function test_agrees_with_every_shared_email_case( string $address, bool $valid ): void {
		self::assertSame( $valid, EmailRule::is_simple( $address ) );
	}
}
