<?php
/**
 * The Chivabox theme: a block child theme of Twenty Twenty-Five for the Chivabox Movers demo site.
 * Page content lives in `patterns/`, so it translates through the `chivabox` text domain. The
 * business details, the quote form and the JSON-LD come from the moving-quote plugin.
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

add_action(
	'wp_enqueue_scripts',
	static function (): void {
		// The file's own modification time, so a changed stylesheet is never served from a cache.
		$modified = filemtime( get_stylesheet_directory() . '/style.css' );
		wp_enqueue_style( 'chivabox', get_stylesheet_uri(), [], false !== $modified ? (string) $modified : null );
	}
);

add_action( 'wp_head', 'chivabox_head_tags', 1 );

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

/**
 * Prints a plugin shortcode inside a header or footer pattern. Template parts never pass through
 * `the_content`, so a shortcode block there would print its own text; nothing prints when the
 * plugin isn't active.
 */
function chivabox_shortcode( string $tag, string $attributes = '' ): void {
	if ( shortcode_exists( $tag ) ) {
		echo do_shortcode( '[' . $tag . ( '' === $attributes ? '' : ' ' . $attributes ) . ']' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- each moving-quote shortcode escapes its own output.
	}
}

/**
 * The logo mark: a box on the accent tile, decorative beside the site title that names it.
 */
function chivabox_logo(): void {
	echo '<svg class="chivabox-logo" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="#1d4ed8"/><path d="M9 13 16 9l7 4v8l-7 4-7-4z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="M9 13l7 4 7-4M16 17v8" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
}

/**
 * The meta description, Open Graph and Twitter tags of a page, from its excerpt (else the tagline),
 * plus the font preloads, the theme color and the icon. Singular pages only: the demo site has no
 * archives worth sharing.
 */
function chivabox_head_tags(): void {
	$fonts = get_theme_file_uri( 'assets/fonts/' );
	foreach ( [ 'bricolage-grotesque-latin-700-normal.woff2', 'figtree-latin-400-normal.woff2' ] as $font ) {
		printf( '<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n", esc_url( $fonts . $font ) );
	}
	echo '<meta name="theme-color" content="#fafafa">' . "\n";
	if ( ! has_site_icon() ) {
		printf( '<link rel="icon" href="%s" type="image/svg+xml">' . "\n", esc_url( get_theme_file_uri( 'assets/images/icon.svg' ) ) );
	}

	if ( ! is_singular() ) {
		return;
	}

	$post        = get_queried_object();
	$excerpt     = $post instanceof WP_Post ? trim( wp_strip_all_tags( $post->post_excerpt ) ) : '';
	$description = '' !== $excerpt ? $excerpt : (string) get_bloginfo( 'description' );
	$canonical   = wp_get_canonical_url();
	$url         = false !== $canonical ? $canonical : (string) get_permalink();
	$tags        = [
		[ 'name', 'description', $description ],
		[ 'property', 'og:title', wp_get_document_title() ],
		[ 'property', 'og:description', $description ],
		[ 'property', 'og:type', 'website' ],
		[ 'property', 'og:url', $url ],
		[ 'property', 'og:image', get_theme_file_uri( 'assets/images/og-default.jpg' ) ],
		[ 'property', 'og:image:width', '1200' ],
		[ 'property', 'og:image:height', '630' ],
		[ 'property', 'og:image:alt', __( 'A mover pushing a tall stack of moving boxes on a hand truck', 'chivabox' ) ],
		[ 'property', 'og:locale', determine_locale() ],
		[ 'property', 'og:site_name', (string) get_bloginfo( 'name' ) ],
		[ 'name', 'twitter:card', 'summary_large_image' ],
	];
	foreach ( $tags as [ $attribute, $key, $value ] ) {
		printf( '<meta %s="%s" content="%s">' . "\n", esc_attr( $attribute ), esc_attr( $key ), esc_attr( $value ) );
	}
}
