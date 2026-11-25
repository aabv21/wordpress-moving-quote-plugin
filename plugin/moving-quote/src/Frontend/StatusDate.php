<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

/**
 * The date patterns of the customer status page, by the page's language, so a Spanish page reads
 * "25 de diciembre de 2026" whatever the site-wide `date_format` option says. Pure: the caller
 * passes the locale and prints the result through `wp_date()`, which supplies the month names.
 */
final class StatusDate {
	/** `j \d\e F \d\e Y` in Spanish, `F j, Y` in every other language. */
	public static function move_date_format( string $locale ): string {
		return self::is_spanish( $locale ) ? 'j \d\e F \d\e Y' : 'F j, Y';
	}

	/** The move date's pattern plus the hour, for the time the customer confirmed. */
	public static function confirmed_format( string $locale ): string {
		return self::move_date_format( $locale ) . ( self::is_spanish( $locale ) ? ', H:i' : ', g:i a' );
	}

	private static function is_spanish( string $locale ): bool {
		return str_starts_with( $locale, 'es' );
	}
}
