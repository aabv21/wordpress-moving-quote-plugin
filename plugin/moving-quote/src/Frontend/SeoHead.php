<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Settings\Options;

/**
 * Prints the home page's `MovingCompany` JSON-LD. The plugin owns it because it alone knows the
 * business details and the cities served; the theme prints the meta and Open Graph tags.
 */
final class SeoHead {
	public static function register(): void {
		add_action( 'wp_head', [ self::class, 'print_schema' ] );
	}

	public static function print_schema(): void {
		if ( ! is_front_page() ) {
			return;
		}

		$graph = BusinessSchema::graph(
			Options::business(),
			get_bloginfo( 'name' ),
			home_url( '/' ),
			get_bloginfo( 'description' ),
			Shortcode::cities(),
			str_replace( '_', '-', determine_locale() )
		);

		echo BusinessSchema::script( $graph ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON encoded with JSON_HEX_TAG in BusinessSchema::script().
	}
}
