<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Pricing;

use Chivabox\MovingQuote\Pricing\{Calculator, DistanceTable, Extra, MoveType, QuoteInput, Rates, Route, UnknownRouteException};
use Chivabox\MovingQuote\Settings\Defaults;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CalculatorTest extends TestCase {
	/** @return iterable<string, array{QuoteInput, array{per_km?: int, range_percent?: int}, list<int>}> */
	public static function cases(): iterable {
		$brief_one = new QuoteInput( MoveType::Apartment, 2, 'Barranquilla', 'Cartagena', [] );
		return [
			'brief 1: apartment, 2 rooms, no extras' => [ $brief_one, [], [ 1130000, 1017000, 1243000, 120 ] ],
			'distance is symmetric'                  => [ new QuoteInput( MoveType::Apartment, 2, 'Cartagena', 'Barranquilla', [] ), [], [ 1130000, 1017000, 1243000, 120 ] ],
			'brief 2: house with every extra'        => [ new QuoteInput( MoveType::House, 4, 'Cartagena', 'Santa Marta', Extra::cases() ), [], [ 2880000, 2592000, 3168000, 220 ] ],
			'same-city move'                         => [ new QuoteInput( MoveType::Office, 3, 'Barranquilla', 'Barranquilla', [ Extra::Packing ] ), [], [ 1450000, 1305000, 1595000, 0 ] ],
			'five or more rooms'                     => [ new QuoteInput( MoveType::Apartment, 5, 'Barranquilla', 'Santa Marta', [ Extra::Storage ] ), [], [ 1800000, 1620000, 1980000, 100 ] ],
			'duplicate extras count once'            => [ new QuoteInput( MoveType::Apartment, 2, 'Barranquilla', 'Cartagena', [ Extra::Packing, Extra::Packing ] ), [], [ 1330000, 1197000, 1463000, 120 ] ],
			'brief 6: per-km rate change'            => [ $brief_one, [ 'per_km' => 5000 ], [ 1250000, 1125000, 1375000, 120 ] ],
			'range rounds half up to 1,000'          => [ $brief_one, [ 'range_percent' => 15 ], [ 1130000, 961000, 1300000, 120 ] ],
			'zero range'                             => [ $brief_one, [ 'range_percent' => 0 ], [ 1130000, 1130000, 1130000, 120 ] ],
		];
	}

	/**
	 * @param array{per_km?: int, range_percent?: int} $overrides
	 * @param list<int>                                $expected
	 */
	#[DataProvider( 'cases' )]
	public function test_estimate( QuoteInput $input, array $overrides, array $expected ): void {
		$settings = array_replace( Defaults::settings(), $overrides );
		$estimate = Calculator::estimate( $input, Rates::from_settings( $settings ), DistanceTable::from_settings( $settings ) );
		self::assertSame( $expected, [ $estimate->amount, $estimate->low, $estimate->high, $estimate->distance_km ] );
	}

	public function test_unknown_city_throws(): void {
		$this->expectException( UnknownRouteException::class );
		Calculator::estimate( new QuoteInput( MoveType::House, 2, 'Barranquilla', 'Bogotá', [] ), Rates::from_settings( Defaults::settings() ), DistanceTable::from_settings( Defaults::settings() ) );
	}

	public function test_missing_pair_throws(): void {
		$this->expectException( UnknownRouteException::class );
		$table = new DistanceTable( [ new Route( 'A town', 'B town', 10 ), new Route( 'B town', 'C town', 20 ) ] );
		Calculator::estimate( new QuoteInput( MoveType::House, 2, 'A town', 'C town', [] ), Rates::from_settings( Defaults::settings() ), $table );
	}
}
