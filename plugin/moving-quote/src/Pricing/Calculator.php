<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

final class Calculator {
	public static function estimate( QuoteInput $input, Rates $rates, DistanceTable $distances ): Estimate {
		$distance_km = $distances->distance_km( $input->origin, $input->destination );
		if ( null === $distance_km ) {
			$message = sprintf( 'No known distance between "%s" and "%s".', $input->origin, $input->destination );
			// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- pure class; message never reaches HTML output.
			throw new UnknownRouteException( $message );
		}

		$base_rate = $rates->base[ $input->type->value ];
		$extras    = [];
		foreach ( $input->extras as $extra ) {
			$extras[ $extra->value ] = $rates->extras[ $extra->value ];
		}

		$amount = $base_rate
			+ $input->rooms * $rates->per_room
			+ $distance_km * $rates->per_km
			+ array_sum( $extras );

		return new Estimate(
			$amount,
			self::rounded_bound( $amount, 100 - $rates->range_percent ),
			self::rounded_bound( $amount, 100 + $rates->range_percent ),
			$distance_km
		);
	}

	private static function rounded_bound( int $amount, int $percent ): int {
		return intdiv( $amount * $percent + 50000, 100000 ) * 1000;
	}
}
