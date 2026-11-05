<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Settings;

use Chivabox\MovingQuote\Settings\{Defaults, SanitizedSettings, SettingsSanitizer};
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * @phpstan-import-type SettingsShape from Defaults
 */
final class SettingsSanitizerTest extends TestCase {
	/**
	 * @param array<string, mixed> $overrides
	 * @return array<string, mixed>
	 */
	private static function form( array $overrides = [] ): array {
		$d = Defaults::settings();
		return array_replace(
			[
				'base_rates'     => array_map( 'strval', $d['base_rates'] ),
				'per_room'       => '150000',
				'per_km'         => '4000',
				'extras'         => array_map( 'strval', $d['extras'] ),
				'range_percent'  => '10',
				'routes'         => array_map( static fn ( array $r ): array => [ 'from' => $r['from'], 'to' => $r['to'], 'km' => (string) $r['km'] ], $d['routes'] ),
				'webhook_url'    => 'http://n8n:5678/webhook/moving-quote/leads',
				'webhook_secret' => '',
				'team_email'     => 'team@example.com',
			],
			$overrides
		);
	}

	/** @return SettingsShape */
	private static function current(): array {
		return [ ...Defaults::settings(), 'webhook_secret' => str_repeat( 'a', 64 ) ];
	}

	/** @param array<string, mixed> $form */
	private static function sanitize_form( array $form ): SanitizedSettings {
		return SettingsSanitizer::sanitize( $form, self::current() );
	}

	/**
	 * @param array<string, mixed> $row
	 * @return list<array<string, mixed>>
	 */
	private static function routes_with( int $index, array $row ): array {
		/** @var list<array<string, mixed>> $routes */
		$routes           = self::form()['routes'];
		$routes[ $index ] = $row;
		return $routes;
	}

	public function test_accepts_colombian_thousands_separators(): void {
		$r = self::sanitize_form( self::form( [ 'per_km' => '4.500', 'per_room' => '150,000', 'base_rates' => [ 'apartment' => '350000', 'house' => '1.250.000', 'office' => '800 000' ] ] ) );
		self::assertSame( [], $r->errors );
		self::assertSame( [ 4500, 150000, 1250000, 800000 ], [ $r->settings['per_km'], $r->settings['per_room'], $r->settings['base_rates']['house'], $r->settings['base_rates']['office'] ] );
	}

	#[DataProvider( 'amount_typos' )]
	public function test_amount_typos_keep_the_current_value( string $typed ): void {
		$r = self::sanitize_form( self::form( [ 'per_km' => $typed ] ) );
		self::assertSame( 'invalid_amount', $r->errors['per_km'] );
		self::assertSame( 4000, $r->settings['per_km'] );
	}

	/** @return list<array{string}> */
	public static function amount_typos(): array {
		return [ [ '3.5' ], [ 'abc' ], [ '-5' ], [ '' ], [ '12,34' ], [ '100.000.001' ] ];
	}

	/** @param list<array<string, mixed>> $routes */
	#[DataProvider( 'route_errors' )]
	public function test_route_errors_keep_the_current_routes( array $routes, string $key, string $code ): void {
		$r = self::sanitize_form( self::form( [ 'routes' => $routes ] ) );
		self::assertSame( $code, $r->errors[ $key ] );
		self::assertSame( Defaults::settings()['routes'], $r->settings['routes'] );
	}

	/** @return iterable<string, array{list<array<string, mixed>>, string, string}> */
	public static function route_errors(): iterable {
		/** @var list<array<string, mixed>> $base */
		$base = self::form()['routes'];
		return [
			'same city'         => [ self::routes_with( 0, [ 'from' => 'Barranquilla', 'to' => 'barranquilla', 'km' => '5' ] ), 'routes.1', 'same_city' ],
			'reverse duplicate' => [ [ ...$base, [ 'from' => 'Cartagena', 'to' => 'Barranquilla', 'km' => '121' ] ], 'routes.22', 'duplicate_route' ],
			'zero km'           => [ self::routes_with( 0, [ 'from' => 'Barranquilla', 'to' => 'Cartagena', 'km' => '0' ] ), 'routes.1', 'invalid_km' ],
			'km with text'      => [ self::routes_with( 0, [ 'from' => 'Barranquilla', 'to' => 'Cartagena', 'km' => '12km' ] ), 'routes.1', 'invalid_km' ],
			'one-letter city'   => [ self::routes_with( 0, [ 'from' => 'X', 'to' => 'Cartagena', 'km' => '10' ] ), 'routes.1', 'invalid_city' ],
			'all removed'       => [ array_map( static fn ( array $r ): array => [ ...$r, 'remove' => '1' ], $base ), 'routes', 'no_routes' ],
		];
	}

	public function test_route_errors_are_case_insensitive_for_same_city(): void {
		$r = self::sanitize_form( self::form( [ 'routes' => self::routes_with( 0, [ 'from' => 'BARRANQUILLA', 'to' => 'Barranquilla', 'km' => '5' ] ) ] ) );
		self::assertSame( 'same_city', $r->errors['routes.1'] );
	}

	public function test_route_errors_are_case_insensitive_for_duplicate_routes(): void {
		/** @var list<array<string, mixed>> $base */
		$base = self::form()['routes'];
		$r    = self::sanitize_form( self::form( [ 'routes' => [ ...$base, [ 'from' => 'CARTAGENA', 'to' => 'barranquilla', 'km' => '121' ] ] ] ) );
		self::assertSame( 'duplicate_route', $r->errors['routes.22'] );
	}

	public function test_edits_blank_rows_and_removals(): void {
		/** @var list<array<string, mixed>> $routes */
		$routes               = self::form()['routes'];
		$routes[0]['km']      = '125';
		$routes[]             = [ 'from' => '', 'to' => '', 'km' => '' ];
		$routes[20]['remove'] = '1';

		$r = self::sanitize_form( self::form( [ 'routes' => $routes ] ) );

		self::assertSame( [], $r->errors );
		self::assertCount( 20, $r->settings['routes'] );
		self::assertSame( 125, $r->settings['routes'][0]['km'] );
	}

	public function test_range_percent(): void {
		$ok = self::sanitize_form( self::form( [ 'range_percent' => '15' ] ) );
		self::assertSame( [], $ok->errors );
		self::assertSame( 15, $ok->settings['range_percent'] );

		$bad = self::sanitize_form( self::form( [ 'range_percent' => '51' ] ) );
		self::assertSame( 'invalid_percent', $bad->errors['range_percent'] );
		self::assertSame( 10, $bad->settings['range_percent'] );
	}

	public function test_webhook_url(): void {
		$empty = self::sanitize_form( self::form( [ 'webhook_url' => '' ] ) );
		self::assertArrayNotHasKey( 'webhook_url', $empty->errors );
		self::assertSame( '', $empty->settings['webhook_url'] );

		$ftp = self::sanitize_form( self::form( [ 'webhook_url' => 'ftp://example.com/x' ] ) );
		self::assertSame( 'invalid_url', $ftp->errors['webhook_url'] );

		$js = self::sanitize_form( self::form( [ 'webhook_url' => 'javascript:alert(1)' ] ) );
		self::assertSame( 'invalid_url', $js->errors['webhook_url'] );
	}

	public function test_secret(): void {
		$blank = self::sanitize_form( self::form( [ 'webhook_secret' => '' ] ) );
		self::assertArrayNotHasKey( 'webhook_secret', $blank->errors );
		self::assertSame( str_repeat( 'a', 64 ), $blank->settings['webhook_secret'] );

		$short = self::sanitize_form( self::form( [ 'webhook_secret' => 'short' ] ) );
		self::assertSame( 'short_secret', $short->errors['webhook_secret'] );
		self::assertSame( str_repeat( 'a', 64 ), $short->settings['webhook_secret'] );

		$saved = self::sanitize_form( self::form( [ 'webhook_secret' => str_repeat( 'b', 64 ) ] ) );
		self::assertArrayNotHasKey( 'webhook_secret', $saved->errors );
		self::assertSame( str_repeat( 'b', 64 ), $saved->settings['webhook_secret'] );
	}

	public function test_secret_survives_unchanged_with_tricky_characters(): void {
		$tricky = str_repeat( 'x', 20 ) . ' %41 <tag> \\ ' . str_repeat( 'y', 20 );
		$r      = self::sanitize_form( self::form( [ 'webhook_secret' => $tricky ] ) );
		self::assertArrayNotHasKey( 'webhook_secret', $r->errors );
		self::assertTrue( hash_equals( $tricky, $r->settings['webhook_secret'] ) );
	}

	public function test_team_email(): void {
		$empty = self::sanitize_form( self::form( [ 'team_email' => '' ] ) );
		self::assertArrayNotHasKey( 'team_email', $empty->errors );
		self::assertSame( '', $empty->settings['team_email'] );

		$bad = self::sanitize_form( self::form( [ 'team_email' => 'not-an-email' ] ) );
		self::assertSame( 'invalid_email', $bad->errors['team_email'] );
	}

	/**
	 * A saved team address must pass `LeadValidator::is_simple_email()`, or delivery fails later.
	 */
	public function test_team_email_rejects_a_quoted_local_part_filter_validate_email_alone_would_accept(): void {
		$result = self::sanitize_form( self::form( [ 'team_email' => '"a,b"@example.com' ] ) );
		self::assertSame( 'invalid_email', $result->errors['team_email'] );
	}

	public function test_is_idempotent(): void {
		$first  = self::sanitize_form( self::form() );
		$second = SettingsSanitizer::sanitize( $first->settings, self::current() );
		self::assertSame( $first->settings, $second->settings );
		self::assertSame( [], $second->errors );
	}

	public function test_drops_unknown_keys(): void {
		$r = self::sanitize_form( self::form( [ 'evil' => '1' ] ) );
		self::assertArrayNotHasKey( 'evil', $r->settings );
	}
}
