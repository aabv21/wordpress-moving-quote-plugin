<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

/**
 * The address rule the lead form and the Settings page share with n8n.
 */
final class EmailRule {
	/** See `is_simple()`. */
	private const FORBIDDEN_CHARACTER_PATTERN = '/[\s\x{0000}-\x{001F}\x{007F}"(),;:<>[\]\\\\]/u';

	/**
	 * `FILTER_VALIDATE_EMAIL`, minus whitespace, controls, and `" , ; < > ( ) [ ] : \`. The filter
	 * alone accepts `"a,b"@example.com`, which n8n's Gmail node splits into two recipients. Matches
	 * `isSimpleEmail()` in `src/nodes/lead.ts`; `tests/fixtures/email-cases.json` pins both.
	 */
	public static function is_simple( string $value ): bool {
		if ( false === filter_var( $value, FILTER_VALIDATE_EMAIL ) ) {
			return false;
		}
		return 1 !== preg_match( self::FORBIDDEN_CHARACTER_PATTERN, $value );
	}
}
