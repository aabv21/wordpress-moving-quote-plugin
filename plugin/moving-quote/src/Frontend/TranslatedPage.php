<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

/**
 * Picks a page's translation in the visitor's language. Pure: the caller asks the multilingual
 * plugin (Polylang's `pll_get_post()`) and passes its answer.
 */
final class TranslatedPage {
	/**
	 * `pll_get_post()` answers 0 for a page with no translation or no language; that, or anything
	 * but a positive ID, keeps the page itself.
	 */
	public static function id( int $page_id, mixed $translation_id ): int {
		return is_int( $translation_id ) && $translation_id > 0 ? $translation_id : $page_id;
	}
}
