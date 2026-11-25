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
		return RequestLocale::run( RequestLocale::of( $request ), static fn (): WP_REST_Response|WP_Error => self::respond( $request ) );
	}

	private static function respond( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$bucket      = RateLimits::estimate();
		$limiter     = new RateLimiter();
		$retry_after = $limiter->hit( 'estimate', $bucket['limit'], $bucket['window_seconds'] );
		if ( 0 !== $retry_after ) {
			return Responses::rate_limited( $retry_after );
		}

		$input = Responses::json_object( $request );

		$result = LeadValidator::quote( $input, Options::distances() );
		if ( $result instanceof FieldErrors ) {
			return Responses::invalid( $result->errors );
		}

		$estimate = Calculator::estimate( $result, Options::rates(), Options::distances() );

		return new WP_REST_Response( Responses::estimate_body( $estimate, Messages::display( $estimate ) ), 200 );
	}
}
