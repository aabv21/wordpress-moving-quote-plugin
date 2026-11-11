<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Frontend;

use Chivabox\MovingQuote\Frontend\TranslatedPage;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class TranslatedPageTest extends TestCase {
	private const PAGE_ID = 12;

	public function test_a_translation_replaces_the_page(): void {
		self::assertSame( 34, TranslatedPage::id( self::PAGE_ID, 34 ) );
	}

	public function test_the_page_itself_stays_when_it_is_its_own_translation(): void {
		self::assertSame( self::PAGE_ID, TranslatedPage::id( self::PAGE_ID, self::PAGE_ID ) );
	}

	#[DataProvider( 'no_translation' )]
	public function test_no_usable_translation_keeps_the_page( mixed $translation_id ): void {
		self::assertSame( self::PAGE_ID, TranslatedPage::id( self::PAGE_ID, $translation_id ) );
	}

	/** @return iterable<string, array{mixed}> */
	public static function no_translation(): iterable {
		return [
			'untranslated, or no language (0)' => [ 0 ],
			'a negative id'                    => [ -1 ],
			'false, from an older Polylang'    => [ false ],
			'null'                             => [ null ],
			'a numeric string'                 => [ '34' ],
		];
	}
}
