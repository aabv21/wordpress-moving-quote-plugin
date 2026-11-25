<?php
/**
 * The Chivabox theme: a block child theme of Twenty Twenty-Five for the Chivabox Movers demo site.
 * Page content lives in `patterns/`, so it translates through the `chivabox` text domain.
 *
 * @package Chivabox
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

add_action(
	'after_setup_theme',
	static function (): void {
		load_theme_textdomain( 'chivabox', get_stylesheet_directory() . '/languages' );
	}
);

add_action(
	'init',
	static function (): void {
		register_block_pattern_category( 'chivabox', [ 'label' => __( 'Chivabox', 'chivabox' ) ] );
	}
);

/**
 * A demo page's URL in the visitor's language, by its English slug; `''` is the home page. With
 * Polylang, the page's translation; without it, the page itself. The home page when the page is
 * missing, so a pattern never prints an empty link.
 */
function chivabox_page_url( string $english_slug ): string {
	if ( '' === $english_slug ) {
		return function_exists( 'pll_home_url' ) ? (string) pll_home_url() : home_url( '/' );
	}

	$page = get_page_by_path( $english_slug );
	if ( ! $page instanceof WP_Post ) {
		return home_url( '/' );
	}

	$page_id = $page->ID;
	if ( function_exists( 'pll_get_post' ) ) {
		$translation = pll_get_post( $page_id );
		if ( is_int( $translation ) && $translation > 0 ) {
			$page_id = $translation;
		}
	}

	$url = get_permalink( $page_id );
	return false !== $url ? $url : home_url( '/' );
}
