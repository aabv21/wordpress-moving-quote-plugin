<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Pricing;

use Chivabox\MovingQuote\Pricing\{DistanceTable, Route};
use Chivabox\MovingQuote\Settings\Defaults;
use PHPUnit\Framework\TestCase;

final class DistanceTableTest extends TestCase {
	public function test_cities_are_unique_and_sorted(): void {
		$table = DistanceTable::from_settings( Defaults::settings() );
		self::assertSame(
			[ 'Barranquilla', 'Cartagena', 'Montería', 'Riohacha', 'Santa Marta', 'Sincelejo', 'Valledupar' ],
			$table->cities()
		);
	}

	public function test_distances(): void {
		$table = DistanceTable::from_settings( Defaults::settings() );
		self::assertSame( 170, $table->distance_km( 'Santa Marta', 'Riohacha' ) );
		self::assertSame( 170, $table->distance_km( 'Riohacha', 'Santa Marta' ) );
		self::assertSame( 0, $table->distance_km( 'Cartagena', 'Cartagena' ) );
		self::assertNull( $table->distance_km( 'Cartagena', 'Bogotá' ) );
		self::assertNull( $table->distance_km( 'Bogotá', 'Bogotá' ) );
	}

	public function test_missing_pairs(): void {
		self::assertSame( [], DistanceTable::from_settings( Defaults::settings() )->missing_pairs() );

		$table = new DistanceTable( [ new Route( 'A town', 'B town', 10 ), new Route( 'B town', 'C town', 20 ) ] );
		self::assertSame( [ [ 'A town', 'C town' ] ], $table->missing_pairs() );
	}

	public function test_cities_dedupes_case_insensitively_keeping_the_first_spelling(): void {
		$table = new DistanceTable(
			[
				new Route( 'Cartagena', 'Barranquilla', 120 ),
				new Route( 'cartagena', 'Santa Marta', 220 ),
			]
		);
		self::assertSame( [ 'Barranquilla', 'Cartagena', 'Santa Marta' ], $table->cities() );
	}
}
