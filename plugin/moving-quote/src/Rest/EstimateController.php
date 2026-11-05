<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Rest;

use Chivabox\MovingQuote\Leads\{FieldErrors, LeadValidator};
use Chivabox\MovingQuote\Pricing\Calculator;
use Chivabox\MovingQuote\Security\{RateLimiter, RateLimits};
use Chivabox\MovingQuote\Settings\Options;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * No nonce, no customer data, nothing saved.
 */
final class EstimateController {
	private const NAMESPACE = 'moving-quote/v1';
	private const ROUTE     = '/estimate';

	public static function register(): void {
		// No args schema: core would answer its own 400 before the contract's 422.
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			[
				'methods'             => 'POST',
				'callback'            => [ self::class, 'handle' ],
				'permission_callback' => '__return_true',
			]
		);
	}

	public static function handle( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$bucket      = RateLimits::estimate();
		$limiter     = new RateLimiter();
		$retry_after = $limiter->hit( 'estimate', $bucket['limit'], $bucket['window_seconds'] );
		if ( 0 !== $retry_after ) {
			return self::rate_limited( $retry_after );
		}

		$input = self::json_object( $request );

		$result = LeadValidator::quote( $input, Options::distances() );
		if ( $result instanceof FieldErrors ) {
			return self::invalid( $result );
		}

		$estimate = Calculator::estimate( $result, Options::rates(), Options::distances() );

		return new WP_REST_Response(
			[
				'amount'      => $estimate->amount,
				'low'         => $estimate->low,
				'high'        => $estimate->high,
				'distance_km' => $estimate->distance_km,
				'currency'    => 'COP',
				'display'     => Messages::display( $estimate ),
			],
			200
		);
	}

	private static function invalid( FieldErrors $errors ): WP_Error {
		$messages = Messages::fields( $errors->errors );
		return new WP_Error(
			'moving_quote_invalid',
			__( 'Please fix the highlighted fields.', 'moving-quote' ),
			[
				'status' => 422,
				'errors' => $messages,
			]
		);
	}

	private static function rate_limited( int $retry_after ): WP_Error {
		header( 'Retry-After: ' . $retry_after );
		return new WP_Error(
			'moving_quote_rate_limited',
			__( 'Too many requests. Please try again later.', 'moving-quote' ),
			[ 'status' => 429 ]
		);
	}

	/**
	 * The stub types get_json_params() as array, but a top-level JSON scalar decodes to that scalar.
	 *
	 * @return array<string, mixed>
	 */
	private static function json_object( WP_REST_Request $request ): array {
		$params = $request->get_json_params(); // @phpstan-ignore-next-line function.alreadyNarrowedType (see the note above: the stub is optimistic)
		return is_array( $params ) ? $params : [];
	}
}
