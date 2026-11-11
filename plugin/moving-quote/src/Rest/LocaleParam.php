<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Rest;

/**
 * The `locale` query arg each REST URL in the form's config carries: the quote page's own
 * language. A multilingual plugin sets the language per page, from its URL, but a REST request
 * has no language in its URL, so the page passes it along. Pure: the caller supplies the
 * installed locales.
 */
final class LocaleParam {
	public const NAME = 'locale';

	/**
	 * Null unless the value is exactly one of the installed locales, so a request can never store
	 * or switch to anything else.
	 *
	 * @param list<string> $installed
	 */
	public static function pick( mixed $requested, array $installed ): ?string {
		return is_string( $requested ) && in_array( $requested, $installed, true ) ? $requested : null;
	}
}
