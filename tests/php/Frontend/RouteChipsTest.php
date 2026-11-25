<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Frontend;

use Chivabox\MovingQuote\Frontend\RouteChips;
use Chivabox\MovingQuote\Pricing\{DistanceTable, Rates};
use Chivabox\MovingQuote\Settings\Defaults;
use PHPUnit\Framework\TestCase;

final class RouteChipsTest extends TestCase {
	/**
	 * @param list<array{string, string}> $pairs
	 * @return list<array{origin: string, destination: string, from_cop: int}>
	 */
	private static function chips( array $pairs ): array {
		$settings = Defaults::settings();
		return RouteChips::from( $pairs, DistanceTable::from_settings( $settings ), Rates::from_settings( $settings ) );
	}

	public function test_prices_from_a_one_room_apartment_with_no_extras(): void {
		self::assertSame(
			[
				[
					'origin'      => 'Barranquilla',
					'destination' => 'Cartagena',
					'from_cop'    => 882000,
				],
				[
					'origin'      => 'Barranquilla',
					'destination' => 'Santa Marta',
					'from_cop'    => 810000,
				],
				[
					'origin'      => 'Cartagena',
					'destination' => 'Santa Marta',
					'from_cop'    => 1242000,
				],
			],
			self::chips( [ [ 'Barranquilla', 'Cartagena' ], [ 'Barranquilla', 'Santa Marta' ], [ 'Cartagena', 'Santa Marta' ] ] )
		);
	}

	public function test_skips_a_route_with_no_known_distance(): void {
		$chips = self::chips( [ [ 'Barranquilla', 'Medellín' ], [ 'Barranquilla', 'Cartagena' ] ] );
		self::assertSame( [ 'Cartagena' ], array_column( $chips, 'destination' ) );
	}

	public function test_parses_the_shortcode_routes_attribute(): void {
		self::assertSame(
			[ [ 'Barranquilla', 'Cartagena' ], [ 'Cartagena', 'Santa Marta' ] ],
			RouteChips::parse_pairs( 'Barranquilla:Cartagena, Cartagena:Santa Marta,broken,:Cartagena' )
		);
	}
}
