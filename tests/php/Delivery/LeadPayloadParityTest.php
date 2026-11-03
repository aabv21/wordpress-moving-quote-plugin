<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Delivery;

use Chivabox\MovingQuote\Delivery\LeadPayload;
use Chivabox\MovingQuote\Leads\LeadRecord;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Builds a `LeadRecord` for every edge case in `tests/fixtures/lead-payloads/` and asserts
 * `LeadPayload::body()` matches that fixture byte for byte — proving the committed files are
 * PHP's own real output, not a hand-written guess, for the corpus the TypeScript side's
 * `parseLead()` is checked against in `tests/nodes/lead-payload-parity.test.ts`.
 */
final class LeadPayloadParityTest extends TestCase {
	private const SITE_NAME  = 'Chivabox Movers';
	private const TEAM_EMAIL = 'team@example.com';

	/**
	 * @param array<string, string|null> $overrides
	 * @return array<string, string|null>
	 */
	private static function row( array $overrides = [] ): array {
		return array_replace(
			[
				'id'                => '7',
				'request_uuid'      => '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b',
				'created_at'        => '2026-11-04 14:15:00',
				'status'            => 'new',
				'move_type'         => 'apartment',
				'rooms'             => '2',
				'origin_city'       => 'Barranquilla',
				'destination_city'  => 'Cartagena',
				'distance_km'       => '120',
				'move_date'         => '2026-11-20',
				'extras'            => 'packing',
				'customer_name'     => 'José Peña',
				'phone'             => '570000000001',
				'email'             => 'jose@example.com',
				'consent_at'        => '2026-11-04 14:15:00',
				'estimate_cop'      => '1330000',
				'estimate_low_cop'  => '1197000',
				'estimate_high_cop' => '1463000',
				'sync_status'       => 'pending',
				'attempts'          => '0',
				'next_attempt_at'   => '1793802900',
				'last_error'        => '',
				'sent_at'           => null,
				'locale'            => 'en_US',
			],
			$overrides
		);
	}

	/** @return iterable<string, array{string, array<string, string|null>, string}> */
	public static function cases(): iterable {
		yield 'range zero with an amount not a multiple of 1,000' => [
			'range-zero-amount-not-rounded',
			self::row(
				[
					'origin_city'       => 'Cartagena',
					'destination_city'  => 'Sincelejo',
					'distance_km'       => '185',
					'extras'            => '',
					'estimate_cop'      => '1482500',
					'estimate_low_cop'  => '1483000',
					'estimate_high_cop' => '1483000',
				]
			),
			self::SITE_NAME,
		];

		yield 'a same-city, zero-distance move' => [
			'same-city-zero-distance',
			self::row(
				[
					'move_type'         => 'house',
					'rooms'             => '1',
					'origin_city'       => 'Barranquilla',
					'destination_city'  => 'Barranquilla',
					'distance_km'       => '0',
					'extras'            => '',
					'estimate_cop'      => '650000',
					'estimate_low_cop'  => '585000',
					'estimate_high_cop' => '715000',
				]
			),
			self::SITE_NAME,
		];

		yield 'every extra, once each' => [
			'every-extra',
			self::row(
				[
					'move_type'         => 'office',
					'rooms'             => '3',
					'extras'            => 'packing,furniture_assembly,storage,piano_fragile',
					'estimate_cop'      => '2630000',
					'estimate_low_cop'  => '2367000',
					'estimate_high_cop' => '2893000',
				]
			),
			self::SITE_NAME,
		];

		yield 'the maximum rooms' => [
			'maximum-rooms',
			self::row(
				[
					'move_type'         => 'house',
					'rooms'             => '5',
					'extras'            => '',
					'estimate_cop'      => '1730000',
					'estimate_low_cop'  => '1557000',
					'estimate_high_cop' => '1903000',
				]
			),
			self::SITE_NAME,
		];

		yield 'a name validate_name() normalized from a tab to a space' => [
			'name-normalized-from-tab',
			self::row( [ 'customer_name' => 'Jose Pena' ] ),
			self::SITE_NAME,
		];

		yield 'a name of exactly 100 code points with an emoji' => [
			'name-100-codepoints-with-emoji',
			self::row( [ 'customer_name' => str_repeat( 'A', 99 ) . '😀' ] ),
			self::SITE_NAME,
		];

		yield 'a plus-tagged email' => [
			'plus-tagged-email',
			self::row( [ 'email' => 'jose.pena+quotes@example.com' ] ),
			self::SITE_NAME,
		];

		yield 'an empty site_name' => [
			'empty-site-name',
			self::row(),
			'',
		];

		yield 'a lead submitted while the site language was Spanish' => [
			'spanish-locale',
			self::row( [ 'locale' => 'es_CO' ] ),
			self::SITE_NAME,
		];

		yield 'a row saved before the locale column existed' => [
			'empty-locale',
			self::row( [ 'locale' => '' ] ),
			self::SITE_NAME,
		];
	}

	/** @param array<string, string|null> $row */
	#[DataProvider( 'cases' )]
	public function test_body_matches_its_fixture( string $fixture, array $row, string $site_name ): void {
		$body     = LeadPayload::body( LeadRecord::from_row( $row ), $site_name, self::TEAM_EMAIL, new \DateTimeZone( 'America/Bogota' ) );
		$expected = trim( (string) file_get_contents( dirname( __DIR__, 2 ) . '/fixtures/lead-payloads/' . $fixture . '.json' ) );
		self::assertSame( $expected, $body );
	}
}
