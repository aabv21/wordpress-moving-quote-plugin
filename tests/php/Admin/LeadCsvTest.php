<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Admin;

use Chivabox\MovingQuote\Admin\LeadCsv;
use Chivabox\MovingQuote\Leads\LeadRecord;
use Chivabox\MovingQuote\Tests\Fixtures;
use PHPUnit\Framework\TestCase;

final class LeadCsvTest extends TestCase {
	public function test_row_matches_the_fixture_lead_exactly(): void {
		$row = LeadCsv::row( LeadRecord::from_row( Fixtures::lead_row() ), new \DateTimeZone( 'America/Bogota' ) );

		self::assertSame(
			[ '2026-11-04 09:15', 'MQ-6F1C2A9E', 'new', 'José Peña', '570000000001', 'jose@example.com', '2026-11-20', 'apartment', '2', 'Barranquilla', 'Cartagena', '120', 'packing', '1330000', '1197000', '1463000', 'pending', 'en_US', '', '' ],
			$row
		);
	}

	public function test_the_header_ends_with_notes_then_the_date_confirmation(): void {
		self::assertSame( [ 'notes', 'date_confirmed_at' ], array_slice( LeadCsv::HEADER, -2 ) );
		self::assertCount( count( LeadCsv::HEADER ), LeadCsv::row( LeadRecord::from_row( Fixtures::lead_row() ), new \DateTimeZone( 'America/Bogota' ) ) );
	}

	public function test_the_confirmation_time_is_in_the_given_time_zone(): void {
		$row = LeadCsv::row( LeadRecord::from_row( [ ...Fixtures::lead_row(), 'date_confirmed_at' => '2026-11-05 15:30:00' ] ), new \DateTimeZone( 'America/Bogota' ) );

		self::assertSame( '2026-11-05 10:30', $row[19] );
	}

	public function test_a_note_is_escaped_in_its_cell(): void {
		$row = LeadCsv::row( LeadRecord::from_row( [ ...Fixtures::lead_row(), 'notes' => '=1+1' ] ), new \DateTimeZone( 'America/Bogota' ) );

		self::assertSame( '\'=1+1', $row[18] );
	}

	public function test_a_formula_looking_name_is_escaped_in_its_cell(): void {
		$row = LeadCsv::row( LeadRecord::from_row( [ ...Fixtures::lead_row(), 'customer_name' => '=cmd|\' /C calc\'!A0' ] ), new \DateTimeZone( 'America/Bogota' ) );

		self::assertSame( '\'=cmd|\' /C calc\'!A0', $row[3] );
	}
}
