<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Rest;

use Chivabox\MovingQuote\Pricing\Estimate;
use WP_Error;
use WP_REST_Request;

/**
 * The error and success bodies both REST routes answer with, so the two cannot drift apart.
 */
final class Responses {
	/**
	 * @param array<string, string> $errors Field name to error code.
	 */
	public static function invalid( array $errors ): WP_Error {
		return new WP_Error(
			'moving_quote_invalid',
			__( 'Please fix the highlighted fields.', 'moving-quote' ),
			[
				'status' => 422,
				'errors' => Messages::fields( $errors ),
			]
		);
	}

	public static function rate_limited( int $retry_after ): WP_Error {
		header( 'Retry-After: ' . $retry_after );
		return new WP_Error(
			'moving_quote_rate_limited',
			__( 'Too many requests. Please try again later.', 'moving-quote' ),
			[ 'status' => 429 ]
		);
	}

	public static function save_failed(): WP_Error {
		return new WP_Error(
			'moving_quote_save_failed',
			__( 'Something went wrong. Please try again.', 'moving-quote' ),
			[ 'status' => 500 ]
		);
	}

	/**
	 * The stub types get_json_params() as array, but a top-level JSON scalar decodes to that scalar.
	 *
	 * @return array<string, mixed>
	 */
	public static function json_object( WP_REST_Request $request ): array {
		$params = $request->get_json_params(); // @phpstan-ignore-next-line function.alreadyNarrowedType (see the note above: the stub is optimistic)
		return is_array( $params ) ? $params : [];
	}

	/**
	 * @return array{amount: int, low: int, high: int, distance_km: int, currency: string, display: string}
	 */
	public static function estimate_body( Estimate $estimate, string $display ): array {
		return [
			'amount'      => $estimate->amount,
			'low'         => $estimate->low,
			'high'        => $estimate->high,
			'distance_km' => $estimate->distance_km,
			'currency'    => Estimate::CURRENCY,
			'display'     => $display,
		];
	}
}
