<?php
/**
 * Plugin Name: Chivabox Movers: translated navigation
 * Description: Lets Polylang give each block navigation menu a language, so the header menu follows the visitor's language.
 * License: MIT
 *
 * Part of the demo site, not of the moving-quote plugin. Polylang (free) translates posts, pages,
 * and synced patterns, but not `wp_navigation` posts. Twenty Twenty-Five's header navigation has no
 * `ref`, so it renders the most recently published menu, through a `WP_Query` that Polylang
 * filters by the current language once the post type is translated. `setup.sh` creates one menu
 * per language.
 *
 * @package Chivabox\MovingQuote
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

add_filter(
	'pll_get_post_types',
	/**
	 * @param array<string, string> $post_types
	 * @return array<string, string>
	 */
	static function ( array $post_types, bool $is_settings ): array {
		// Not on Polylang's settings page: there, the list is the custom post types a user may toggle.
		if ( ! $is_settings ) {
			$post_types['wp_navigation'] = 'wp_navigation';
		}
		return $post_types;
	},
	10,
	2
);
