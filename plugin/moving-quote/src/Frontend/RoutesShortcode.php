<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Rest\Messages;
use Chivabox\MovingQuote\Settings\Options;

/**
 * `[moving_quote_routes quote="get-a-quote" routes="Barranquilla:Cartagena,…"]`: popular routes as
 * links to the quote page with both cities prefilled, each with its "from" price from the current
 * rates. A route with no known distance is left out.
 */
final class RoutesShortcode {
	public const TAG             = 'moving_quote_routes';
	private const DEFAULT_ROUTES = 'Barranquilla:Cartagena,Barranquilla:Santa Marta,Cartagena:Santa Marta';

	public static function register(): void {
		add_shortcode( self::TAG, [ self::class, 'render' ] );
	}

	/** @param array<string, string>|string $atts */
	public static function render( array|string $atts ): string {
		$parsed    = shortcode_atts(
			[
				'quote'  => 'get-a-quote',
				'routes' => self::DEFAULT_ROUTES,
			],
			is_array( $atts ) ? $atts : []
		);
		$quote_url = Shortcode::page_url( (string) $parsed['quote'] );
		$chips     = RouteChips::from( RouteChips::parse_pairs( (string) $parsed['routes'] ), Options::distances(), Options::rates() );
		if ( null === $quote_url || [] === $chips ) {
			return '';
		}
		wp_enqueue_style( Shortcode::HANDLE );

		$items = '';
		foreach ( $chips as $chip ) {
			$href   = add_query_arg(
				[
					Prefill::FROM_ARG => rawurlencode( $chip['origin'] ),
					Prefill::TO_ARG   => rawurlencode( $chip['destination'] ),
				],
				$quote_url
			);
			$items .= sprintf(
				'<li><a class="moving-quote-route" href="%s"><span class="moving-quote-route__cities">%s <span aria-hidden="true">→</span><span class="moving-quote-visually-hidden"> %s </span> %s</span> <span class="moving-quote-route__price">%s</span></a></li>',
				esc_url( $href ),
				esc_html( $chip['origin'] ),
				esc_html_x( 'to', 'route: origin to destination', 'moving-quote' ),
				esc_html( $chip['destination'] ),
				esc_html( Messages::from_price( $chip['from_cop'] ) )
			);
		}

		// role="list" keeps the list semantics Safari drops from a list styled with list-style: none.
		return '<ul class="moving-quote-routes" role="list">' . $items . '</ul>';
	}
}
