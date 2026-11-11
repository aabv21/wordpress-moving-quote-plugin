<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Rest;

use WP_REST_Request;

/**
 * Runs a REST route in the language of the page that called it, so field messages, the price's
 * separators, and a lead's stored locale follow the page, not the site language.
 */
final class RequestLocale {
	/**
	 * The page's locale when the request names an installed one, else `determine_locale()`: a
	 * client that sends none (an older cached page, a script) gets the old behavior.
	 */
	public static function of( WP_REST_Request $request ): string {
		return LocaleParam::pick( $request->get_param( LocaleParam::NAME ), self::installed() ) ?? determine_locale();
	}

	/**
	 * @template T
	 * @param callable(): T $callback
	 * @return T
	 */
	public static function run( string $locale, callable $callback ): mixed {
		// False when the locale is already current, or not installed; nothing to restore then.
		$switched = switch_to_locale( $locale );
		try {
			return $callback();
		} finally {
			if ( $switched ) {
				restore_previous_locale();
			}
		}
	}

	/**
	 * The same list `switch_to_locale()` accepts.
	 *
	 * @return list<string>
	 */
	private static function installed(): array {
		return array_values( array_unique( array_merge( [ 'en_US' ], get_available_languages() ) ) );
	}
}
