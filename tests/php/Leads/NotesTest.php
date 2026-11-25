<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Leads;

use Chivabox\MovingQuote\Leads\LeadRepository;
use PHPUnit\Framework\TestCase;

final class NotesTest extends TestCase {
	public function test_trims_and_keeps_line_breaks(): void {
		self::assertSame( "Call back\nafter 5", LeadRepository::clean_notes( "  Call back\r\nafter 5 \n" ) );
	}

	public function test_removes_control_characters_except_the_line_feed(): void {
		self::assertSame( "a\nbc", LeadRepository::clean_notes( "a\n\x00b\x07\x1Fc\x7F" ) );
	}

	public function test_cuts_to_2000_characters_not_bytes(): void {
		$cut = LeadRepository::clean_notes( str_repeat( 'ñ', 2500 ) );

		self::assertSame( 2000, mb_strlen( $cut ) );
		self::assertSame( 2000, mb_strlen( LeadRepository::clean_notes( str_repeat( 'a', 2000 ) ) ) );
	}
}
