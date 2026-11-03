<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Leads;

use Chivabox\MovingQuote\Leads\{LeadRecord, LeadStatus, SyncStatus};
use Chivabox\MovingQuote\Tests\Fixtures;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class LeadRecordTest extends TestCase {
	public function test_from_row_types_every_column(): void {
		$record = LeadRecord::from_row( Fixtures::lead_row() );

		self::assertSame( 7, $record->id );
		self::assertSame( 'MQ-6F1C2A9E', $record->reference() );
		self::assertSame( LeadStatus::New, $record->status );
		self::assertSame( SyncStatus::Pending, $record->sync_status );
		self::assertSame( [ 'packing' ], $record->extras );
		self::assertSame( 1330000, $record->estimate_cop );
		self::assertNull( $record->sent_at );
		self::assertSame( 'en_US', $record->locale );
	}

	public function test_a_row_read_before_the_locale_column_exists_has_an_empty_locale(): void {
		$row = Fixtures::lead_row();
		unset( $row['locale'] );
		self::assertSame( '', LeadRecord::from_row( $row )->locale );
	}

	public function test_blank_extras_is_an_empty_list(): void {
		$record = LeadRecord::from_row( [ ...Fixtures::lead_row(), 'extras' => '' ] );
		self::assertSame( [], $record->extras );
	}

	public function test_is_reference_accepts_what_reference_for_builds(): void {
		self::assertTrue( LeadRecord::is_reference( LeadRecord::reference_for( '6f1c2a9e-0b7d-4c3e-9a51-2f8e7d6c5b4a' ) ) );
		self::assertTrue( LeadRecord::is_reference( 'MQ-0123ABCD' ) );
	}

	/** @return iterable<string, array{string}> */
	public static function not_a_reference(): iterable {
		yield 'empty' => [ '' ];
		yield 'lowercase hex' => [ 'MQ-0123abcd' ];
		yield 'seven digits' => [ 'MQ-0123ABC' ];
		yield 'nine digits' => [ 'MQ-0123ABCDE' ];
		yield 'a non-hex letter' => [ 'MQ-0123ABCG' ];
		yield 'a different prefix' => [ 'XX-0123ABCD' ];
		yield 'a trailing newline' => [ "MQ-0123ABCD\n" ];
		yield 'markup' => [ 'MQ-<b>1234' ];
	}

	#[DataProvider( 'not_a_reference' )]
	public function test_is_reference_rejects_anything_else( string $value ): void {
		self::assertFalse( LeadRecord::is_reference( $value ) );
	}
}
