<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

/**
 * Guards against formula injection: Excel, LibreOffice, and Google Sheets read a cell starting with
 * `=`, `+`, `-`, `@`, tab, or carriage return as a formula.
 */
final class CsvEscaper {
	/** @var list<string> prefixes that make a spreadsheet application read the cell as a formula */
	private const DANGEROUS_PREFIXES = [ '=', '+', '-', '@', "\t", "\r" ];

	/** `null` becomes `''`; anything else is checked as its string form. */
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
