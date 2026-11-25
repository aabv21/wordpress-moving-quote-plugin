<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Pricing\{Calculator, DistanceTable, MoveType, QuoteInput, Rates};

/**
 * The "from" price of each popular route: the low end of a one-room apartment's estimate with no
 * extras, from the current rates, so a chip never quotes a price the form wouldn't. Pure.
 */
final class RouteChips {
	/**
	 * @param list<array{string, string}> $pairs origin and destination
	 * @return list<array{origin: string, destination: string, from_cop: int}>
	 */
	public static function from( array $pairs, DistanceTable $distances, Rates $rates ): array {
		$chips = [];
		foreach ( $pairs as [ $origin, $destination ] ) {
			if ( null === $distances->distance_km( $origin, $destination ) ) {
				continue;
			}
			$estimate = Calculator::estimate( new QuoteInput( MoveType::Apartment, 1, $origin, $destination, [] ), $rates, $distances );
			$chips[]  = [
				'origin'      => $origin,
				'destination' => $destination,
				'from_cop'    => $estimate->low,
			];
		}
		return $chips;
	}

	/**
	 * `Barranquilla:Cartagena,Cartagena:Santa Marta` → the pairs; a malformed item is skipped.
	 *
	 * @return list<array{string, string}>
	 */
	public static function parse_pairs( string $routes ): array {
		$pairs = [];
		foreach ( explode( ',', $routes ) as $item ) {
			$cities = array_map( 'trim', explode( ':', $item ) );
			if ( 2 === count( $cities ) && '' !== $cities[0] && '' !== $cities[1] ) {
				$pairs[] = [ $cities[0], $cities[1] ];
			}
		}
		return $pairs;
	}
}
