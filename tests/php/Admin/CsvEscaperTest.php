<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Admin;

use Chivabox\MovingQuote\Admin\CsvEscaper;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class CsvEscaperTest extends TestCase {
	/**
	 * @return iterable<string, array{string|int|null, string}>
	 */
	public static function cells(): iterable {
		yield 'formula injection via HYPERLINK' => [ '=HYPERLINK("http://example.com","x")', '\'=HYPERLINK("http://example.com","x")' ];
		yield 'leading plus' => [ '+57 300', "'+57 300" ];
		yield 'leading minus' => [ '-2+3', "'-2+3" ];
		yield 'leading at sign' => [ '@SUM(A1)', "'@SUM(A1)" ];
		yield 'leading tab' => [ "\tcmd", "'\tcmd" ];
		yield 'leading carriage return' => [ "\rcmd", "'\rcmd" ];
		yield 'a plain accented name is untouched' => [ 'José Peña', 'José Peña' ];
		yield 'an int becomes its string form' => [ 1130000, '1130000' ];
		yield 'null becomes an empty string' => [ null, '' ];
		yield 'an empty string stays empty' => [ '', '' ];
	}

	#[DataProvider( 'cells' )]
	public function test_cell( string|int|null $value, string $expected ): void {
		self::assertSame( $expected, CsvEscaper::cell( $value ) );
	}
}
