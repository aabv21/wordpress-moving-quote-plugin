<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Frontend;

use Chivabox\MovingQuote\Frontend\StatusToken;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class StatusTokenTest extends TestCase {
	private const UUID  = '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b';
	private const OTHER = '11111111-2222-4333-8444-555555555555';
	private const KEY   = 'a-key-that-stands-in-for-the-derived-secret';

	public function test_signs_the_documented_message(): void {
		self::assertSame( hash_hmac( 'sha256', 'moving-quote-status|' . self::UUID, self::KEY ), StatusToken::sign( self::UUID, self::KEY ) );
		self::assertMatchesRegularExpression( '/^[0-9a-f]{64}$/D', StatusToken::sign( self::UUID, self::KEY ) );
	}

	public function test_verifies_its_own_token(): void {
		self::assertTrue( StatusToken::verify( self::UUID, StatusToken::sign( self::UUID, self::KEY ), self::KEY ) );
	}

	public function test_rejects_a_token_for_another_lead(): void {
		self::assertFalse( StatusToken::verify( self::OTHER, StatusToken::sign( self::UUID, self::KEY ), self::KEY ) );
	}

	public function test_rejects_a_token_signed_with_another_key(): void {
		self::assertFalse( StatusToken::verify( self::UUID, StatusToken::sign( self::UUID, 'another key' ), self::KEY ) );
	}

	public function test_rejects_a_token_one_character_off(): void {
		$token   = StatusToken::sign( self::UUID, self::KEY );
		$flipped = substr( $token, 0, 63 ) . ( 'a' === $token[63] ? 'b' : 'a' );

		self::assertFalse( StatusToken::verify( self::UUID, $flipped, self::KEY ) );
	}

	/** @return iterable<string, array{string}> */
	public static function malformed_tokens(): iterable {
		$token = StatusToken::sign( self::UUID, self::KEY );

		yield '63 hex' => [ substr( $token, 0, 63 ) ];
		yield '65 hex' => [ $token . '0' ];
		yield 'uppercase' => [ strtoupper( $token ) ];
		yield 'with a trailing newline' => [ $token . "\n" ];
		yield 'not hex' => [ str_repeat( 'g', 64 ) ];
	}

	#[DataProvider( 'malformed_tokens' )]
	public function test_rejects_a_token_of_the_wrong_length_or_case( string $token ): void {
		self::assertFalse( StatusToken::verify( self::UUID, $token, self::KEY ) );
	}

	public function test_rejects_an_empty_token(): void {
		self::assertFalse( StatusToken::verify( self::UUID, '', self::KEY ) );
	}

	public function test_is_valid_uuid_accepts_only_a_lowercase_v4(): void {
		self::assertTrue( StatusToken::is_uuid( self::UUID ) );
		self::assertFalse( StatusToken::is_uuid( strtoupper( self::UUID ) ) );
		self::assertFalse( StatusToken::is_uuid( self::UUID . "\n" ) );
		self::assertFalse( StatusToken::is_uuid( '6f1c2a9e-3b4d-1e8f-9a1b-2c3d4e5f6a7b' ) );
		self::assertFalse( StatusToken::is_uuid( '' ) );
	}
}
