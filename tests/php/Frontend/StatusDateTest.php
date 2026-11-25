<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Frontend;

use Chivabox\MovingQuote\Frontend\StatusDate;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class StatusDateTest extends TestCase {
	/** @return iterable<string, array{string, string, string}> */
	public static function move_dates(): iterable {
		yield 'Spanish (Colombia)' => [ 'es_CO', '2026-12-25', '25 de diciembre de 2026' ];
		yield 'Spanish (Spain)' => [ 'es_ES', '2026-03-05', '5 de marzo de 2026' ];
		yield 'English' => [ 'en_US', '2026-12-25', 'December 25, 2026' ];
		yield 'an unknown language' => [ 'pt_BR', '2026-12-25', 'December 25, 2026' ];
		yield 'no locale' => [ '', '2026-12-25', 'December 25, 2026' ];
	}

	/** The names come from `wp_date()` in the active locale; this stands in with English names, so only the pattern is under test. */
	#[DataProvider( 'move_dates' )]
	public function test_the_move_date_pattern_follows_the_page_language( string $locale, string $iso, string $expected ): void {
		$pattern = StatusDate::move_date_format( $locale );
		$months  = [ 'January' => 'enero', 'February' => 'febrero', 'March' => 'marzo', 'December' => 'diciembre' ];
		$text    = ( new \DateTimeImmutable( $iso ) )->format( $pattern );
		if ( str_starts_with( $locale, 'es' ) ) {
			$text = strtr( $text, $months );
		}

		self::assertSame( $expected, $text );
	}

	public function test_the_confirmation_time_pattern_adds_the_hour(): void {
		$at = new \DateTimeImmutable( '2026-11-05 15:30:00' );

		self::assertSame( '5 de November de 2026, 15:30', $at->format( StatusDate::confirmed_format( 'es_CO' ) ) );
		self::assertSame( 'November 5, 2026, 3:30 pm', $at->format( StatusDate::confirmed_format( 'en_US' ) ) );
	}
}
