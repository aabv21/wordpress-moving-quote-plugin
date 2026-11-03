<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Security;

use Chivabox\MovingQuote\Security\RateLimiter;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class RateLimiterTest extends TestCase {
	public function test_ipv4_is_unchanged(): void {
		self::assertSame( '203.0.113.7', RateLimiter::normalize_ip( '203.0.113.7' ) );
	}

	public function test_two_ipv6_addresses_in_the_same_slash_64_normalize_to_the_same_key(): void {
		$first  = RateLimiter::normalize_ip( '2001:db8:1234:5678:aaaa:bbbb:cccc:dddd' );
		$second = RateLimiter::normalize_ip( '2001:db8:1234:5678:1111:2222:3333:4444' );
		self::assertSame( $first, $second );
		self::assertSame( '2001:db8:1234:5678::', $first );
	}

	public function test_two_ipv6_addresses_in_different_slash_64s_normalize_differently(): void {
		$first  = RateLimiter::normalize_ip( '2001:db8:1234:5678::1' );
		$second = RateLimiter::normalize_ip( '2001:db8:1234:5679::1' );
		self::assertNotSame( $first, $second );
	}

	public function test_an_ipv4_mapped_ipv6_address_is_unchanged(): void {
		self::assertSame( '::ffff:203.0.113.7', RateLimiter::normalize_ip( '::ffff:203.0.113.7' ) );
	}

	#[DataProvider( 'non_ip_values' )]
	public function test_a_value_that_does_not_parse_as_an_ip_is_unchanged( string $value ): void {
		self::assertSame( $value, RateLimiter::normalize_ip( $value ) );
	}

	/** @return iterable<string, array{string}> */
	public static function non_ip_values(): iterable {
		return [
			'empty string'   => [ '' ],
			'not an address' => [ 'not-an-ip' ],
		];
	}
}
