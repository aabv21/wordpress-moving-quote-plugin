<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Leads;

use Chivabox\MovingQuote\Leads\{FieldErrors, LeadDraft, LeadValidator};
use Chivabox\MovingQuote\Pricing\{DistanceTable, Extra, MoveType, Route};
use Chivabox\MovingQuote\Settings\Defaults;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class LeadValidatorTest extends TestCase {
	/**
	 * @param array<string, mixed> $overrides
	 * @return array<string, mixed>
	 */
	private static function valid( array $overrides = [] ): array {
		return array_replace(
			[
				'submission_id' => '6F1C2A9E-3B4D-4E8F-9A1B-2C3D4E5F6A7B',
				'move_type'     => 'apartment',
				'rooms'         => 2,
				'origin'        => 'Barranquilla',
				'destination'   => 'Cartagena',
				'move_date'     => '2026-11-20',
				'extras'        => [ 'packing', 'packing' ],
				'name'          => 'José Peña',
				'phone'         => '+57 000 000 0001',
				'email'         => 'jose@example.com',
				'consent'       => true,
			],
			$overrides
		);
	}

	/** @param array<string, mixed> $input */
	private static function lead( array $input, string $now = '2026-11-04T14:00:00Z' ): LeadDraft|FieldErrors {
		return LeadValidator::lead( $input, DistanceTable::from_settings( Defaults::settings() ), new \DateTimeImmutable( $now ), new \DateTimeZone( 'America/Bogota' ) );
	}

	public function test_valid_input_is_normalized(): void {
		$draft = self::lead( self::valid() );
		self::assertInstanceOf( LeadDraft::class, $draft );
		self::assertSame( [ '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b', '570000000001', 'José Peña', '2026-11-20' ], [ $draft->submission_id, $draft->phone, $draft->name, $draft->move_date ] );
		self::assertSame( [ Extra::Packing ], $draft->quote->extras );
		self::assertSame( MoveType::Apartment, $draft->quote->type );
	}

	/** @return array<string, array{string, ?string}> */
	public static function late_evening(): array {
		return [
			'today in Bogota' => [ '2026-11-04', null ],
			'yesterday'       => [ '2026-11-03', 'past_date' ],
			'365 days ahead'  => [ '2027-11-04', null ],
			'366 days ahead'  => [ '2027-11-05', 'too_far' ],
		];
	}

	#[DataProvider( 'late_evening' )]
	public function test_today_is_the_bogota_date( string $move_date, ?string $code ): void {
		$result = self::lead( self::valid( [ 'move_date' => $move_date ] ), '2026-11-05T02:00:00Z' ); // 21:00 on Nov 4 in Bogota.
		self::assertSame( $code, $result instanceof FieldErrors ? $result->errors['move_date'] : null );
	}

	/** @return list<array{string, mixed, string}> */
	public static function invalid_fields(): array {
		return [
			[ 'move_type', 'castle', 'invalid' ],
			[ 'rooms', 0, 'invalid' ],
			[ 'rooms', 6, 'invalid' ],
			[ 'rooms', '2.5', 'invalid' ],
			[ 'origin', 'Bogotá', 'unknown_city' ],
			[ 'extras', 'packing', 'invalid' ],
			[ 'extras', [ 'jacuzzi' ], 'invalid' ],
			[ 'move_date', '2026-02-30', 'invalid' ],
			[ 'move_date', '20/11/2026', 'invalid' ],
			[ 'name', 'J', 'too_short' ],
			[ 'name', str_repeat( 'a', 101 ), 'too_long' ],
			[ 'phone', '12345', 'invalid' ],
			[ 'phone', '57000000000a', 'invalid' ],
			[ 'email', 'jose@', 'invalid' ],
			[ 'consent', false, 'consent_required' ],
			[ 'consent', 'yes', 'consent_required' ],
			[ 'submission_id', 'not-a-uuid', 'invalid' ],
		];
	}

	#[DataProvider( 'invalid_fields' )]
	public function test_invalid_field( string $field, mixed $value, string $code ): void {
		$result = self::lead( self::valid( [ $field => $value ] ) );
		self::assertInstanceOf( FieldErrors::class, $result );
		self::assertSame( $code, $result->errors[ $field ] ?? null );
	}

	public function test_missing_fields_are_all_reported(): void {
		$result = self::lead( [] );
		self::assertInstanceOf( FieldErrors::class, $result );
		self::assertEquals(
			[
				'submission_id' => 'required',
				'move_type'     => 'required',
				'rooms'         => 'required',
				'origin'        => 'required',
				'destination'   => 'required',
				'move_date'     => 'required',
				'name'          => 'required',
				'phone'         => 'required',
				'email'         => 'required',
				'consent'       => 'consent_required',
			],
			$result->errors
		);
	}

	public function test_unknown_route_is_reported_on_destination(): void {
		$table = new DistanceTable( [ new Route( 'Barranquilla', 'Cartagena', 120 ), new Route( 'Cartagena', 'Santa Marta', 220 ) ] );
		$result = LeadValidator::lead(
			self::valid( [ 'origin' => 'Barranquilla', 'destination' => 'Santa Marta' ] ),
			$table,
			new \DateTimeImmutable( '2026-11-04T14:00:00Z' ),
			new \DateTimeZone( 'America/Bogota' )
		);
		self::assertInstanceOf( FieldErrors::class, $result );
		self::assertSame( 'unknown_route', $result->errors['destination'] );
	}

	public function test_quote_checks_only_price_fields(): void {
		$input = [
			'move_type'   => 'house',
			'rooms'       => '4',
			'origin'      => 'Cartagena',
			'destination' => 'Santa Marta',
		];
		$result = LeadValidator::quote( $input, DistanceTable::from_settings( Defaults::settings() ) );
		self::assertInstanceOf( \Chivabox\MovingQuote\Pricing\QuoteInput::class, $result );
		self::assertSame( 4, $result->rooms );
		self::assertSame( [], $result->extras );
	}
}
