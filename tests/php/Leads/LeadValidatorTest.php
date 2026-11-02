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
			[ 'email', '"a,b"@example.com', 'invalid' ],
			[ 'email', 'a b@example.com', 'invalid' ],
			[ 'email', 'x@example.com, y@example.com', 'invalid' ],
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

	/**
	 * `DistanceTable::distance_km()` looks up its routes by exact string, while a city is accepted
	 * case-insensitively — "cartagena" must normalize to the configured "Cartagena" so the route
	 * lookup (and the resulting price) is identical regardless of how the visitor capitalized it.
	 */
	public function test_city_name_is_normalized_to_its_canonical_spelling_so_pricing_matches(): void {
		$distances = DistanceTable::from_settings( Defaults::settings() );

		$lowercase = LeadValidator::quote( [ 'move_type' => 'house', 'rooms' => '4', 'origin' => 'Barranquilla', 'destination' => 'cartagena' ], $distances );
		$canonical = LeadValidator::quote( [ 'move_type' => 'house', 'rooms' => '4', 'origin' => 'Barranquilla', 'destination' => 'Cartagena' ], $distances );

		self::assertInstanceOf( \Chivabox\MovingQuote\Pricing\QuoteInput::class, $lowercase );
		self::assertInstanceOf( \Chivabox\MovingQuote\Pricing\QuoteInput::class, $canonical );
		self::assertSame( 'Cartagena', $lowercase->destination );
		self::assertSame( $canonical->destination, $lowercase->destination );

		$priced_lowercase = \Chivabox\MovingQuote\Pricing\Calculator::estimate( $lowercase, \Chivabox\MovingQuote\Pricing\Rates::from_settings( Defaults::settings() ), $distances );
		$priced_canonical = \Chivabox\MovingQuote\Pricing\Calculator::estimate( $canonical, \Chivabox\MovingQuote\Pricing\Rates::from_settings( Defaults::settings() ), $distances );
		self::assertSame( $priced_canonical->amount, $priced_lowercase->amount );
		self::assertSame( $priced_canonical->distance_km, $priced_lowercase->distance_km );
	}

	/** @return array<string, array{string, string}> */
	public static function control_characters_in_name(): array {
		return [
			'a tab'              => [ "José\tPeña", 'José Peña' ],
			'a newline'          => [ "Ana\nBo", 'Ana Bo' ],
			'a line separator'   => [ "Ana\u{2028}Bo", 'Ana Bo' ],
		];
	}

	#[DataProvider( 'control_characters_in_name' )]
	public function test_name_normalizes_control_characters_to_a_single_space( string $value, string $expected ): void {
		$draft = self::lead( self::valid( [ 'name' => $value ] ) );
		self::assertInstanceOf( LeadDraft::class, $draft );
		self::assertSame( $expected, $draft->name );
	}

	public function test_name_of_only_control_characters_is_too_short(): void {
		$result = self::lead( self::valid( [ 'name' => "\t\n" ] ) );
		self::assertInstanceOf( FieldErrors::class, $result );
		self::assertSame( 'too_short', $result->errors['name'] );
	}

	public function test_invalid_utf8_name_is_invalid(): void {
		$result = self::lead( self::valid( [ 'name' => "Jos\xE9 Pe\xF1a" ] ) );
		self::assertInstanceOf( FieldErrors::class, $result );
		self::assertSame( 'invalid', $result->errors['name'] );
	}

	/** @return array<string, array{string}> */
	public static function simple_emails(): array {
		return [
			'a plain address' => [ 'customer@example.com' ],
			'dotted and plus-tagged local part' => [ 'jose.pena+quotes@example.com' ],
		];
	}

	#[DataProvider( 'simple_emails' )]
	public function test_accepts_a_simple_address( string $email ): void {
		$draft = self::lead( self::valid( [ 'email' => $email ] ) );
		self::assertInstanceOf( LeadDraft::class, $draft );
		self::assertSame( $email, $draft->email );
	}
}
