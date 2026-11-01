<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

/**
 * Guards a CSV cell against formula injection: a leading `=`, `+`, `-`, `@`, tab, or carriage
 * return is how Excel, LibreOffice, and Google Sheets each decide a cell holds a formula, so a
 * stray one in customer-entered data (a name, say) could otherwise execute as a spreadsheet
 * formula the moment the export is opened.
 */
final class CsvEscaper {
	/** @var list<string> prefixes that make a spreadsheet application read the cell as a formula */
	private const DANGEROUS_PREFIXES = [ '=', '+', '-', '@', "\t", "\r" ];

	/** `null` becomes `''`; every other value is cast to its string form before the check runs. */
	public static function cell( string|int|null $value ): string {
		if ( null === $value ) {
			return '';
		}

		$string = (string) $value;
		foreach ( self::DANGEROUS_PREFIXES as $prefix ) {
			if ( str_starts_with( $string, $prefix ) ) {
				return "'" . $string;
			}
		}

		return $string;
	}
}
