<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Leads;

use Chivabox\MovingQuote\Leads\{LeadRecord, LeadStatus, SyncStatus};
use Chivabox\MovingQuote\Tests\Fixtures;
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
	}

	public function test_blank_extras_is_an_empty_list(): void {
		$record = LeadRecord::from_row( [ ...Fixtures::lead_row(), 'extras' => '' ] );
		self::assertSame( [], $record->extras );
	}
}
