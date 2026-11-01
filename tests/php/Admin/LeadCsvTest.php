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
			[ '2026-11-04 09:15', 'MQ-6F1C2A9E', 'new', 'José Peña', '570000000001', 'jose@example.com', '2026-11-20', 'apartment', '2', 'Barranquilla', 'Cartagena', '120', 'packing', '1330000', '1197000', '1463000', 'pending' ],
			$row
		);
	}

	public function test_a_formula_looking_name_is_escaped_in_its_cell(): void {
		$row = LeadCsv::row( LeadRecord::from_row( [ ...Fixtures::lead_row(), 'customer_name' => '=cmd|\' /C calc\'!A0' ] ), new \DateTimeZone( 'America/Bogota' ) );

		self::assertSame( '\'=cmd|\' /C calc\'!A0', $row[3] );
	}
}
