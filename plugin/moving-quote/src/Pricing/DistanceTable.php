<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

use Chivabox\MovingQuote\Settings\Defaults;

/**
 * @phpstan-import-type SettingsShape from Defaults
 */
final class DistanceTable {
	/** @var array<string, array<string, int>> distance in km, keyed by both city names */
	private array $distances = [];

	/** @param list<Route> $routes */
	public function __construct( array $routes ) {
		foreach ( $routes as $route ) {
			$this->distances[ $route->from ][ $route->to ] = $route->km;
			$this->distances[ $route->to ][ $route->from ] = $route->km;
		}
	}

	/** @param SettingsShape $settings */
	public static function from_settings( array $settings ): self {
		$routes = array_map(
			static fn ( array $route ): Route => new Route( $route['from'], $route['to'], $route['km'] ),
			$settings['routes']
		);
		return new self( $routes );
	}

	/** @return list<string> */
	public function cities(): array {
		$cities = array_keys( $this->distances );
		sort( $cities, SORT_STRING | SORT_FLAG_CASE );
		return array_values( array_unique( $cities, SORT_STRING ) );
	}

	public function distance_km( string $from, string $to ): ?int {
		if ( $from === $to ) {
			return in_array( $from, $this->cities(), true ) ? 0 : null;
		}
		return $this->distances[ $from ][ $to ] ?? null;
	}

	/** @return list<array{string, string}> */
	public function missing_pairs(): array {
		$cities  = $this->cities();
		$missing = [];
		foreach ( $cities as $i => $a ) {
			foreach ( $cities as $j => $b ) {
				if ( $j <= $i ) {
					continue;
				}
				if ( null === $this->distance_km( $a, $b ) ) {
					$missing[] = [ $a, $b ];
				}
			}
		}
		return $missing;
	}
}
