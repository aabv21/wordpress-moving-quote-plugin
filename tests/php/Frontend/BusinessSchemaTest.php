<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Frontend;

use Chivabox\MovingQuote\Frontend\BusinessSchema;
use Chivabox\MovingQuote\Settings\{Business, Defaults};
use PHPUnit\Framework\TestCase;

/**
 * @phpstan-import-type SettingsShape from Defaults
 */
final class BusinessSchemaTest extends TestCase {
	private const CITIES = [ 'Barranquilla', 'Cartagena', 'Santa Marta' ];

	/** @param array<string, string> $overrides */
	private static function business( array $overrides = [] ): Business {
		/** @var SettingsShape $settings only business_* string keys are overridden */
		$settings = array_replace( Defaults::settings(), $overrides );
		return Business::from_settings( $settings );
	}

	/**
	 * @param array<string, string> $overrides
	 * @return array<string, mixed>
	 */
	private static function graph( array $overrides = [] ): array {
		return BusinessSchema::graph( self::business( $overrides ), 'Chivabox Movers', 'https://example.com/', 'Moving across Colombia’s Caribbean coast', self::CITIES, 'es-CO' );
	}

	public function test_builds_a_moving_company_with_every_city_served(): void {
		$graph = self::graph();
		self::assertSame( 'https://schema.org', $graph['@context'] );
		self::assertSame( 'MovingCompany', $graph['@type'] );
		self::assertSame( 'Chivabox Movers', $graph['name'] );
		self::assertSame( 'https://example.com/', $graph['url'] );
		self::assertSame( 'Moving across Colombia’s Caribbean coast', $graph['description'] );
		self::assertSame( 'es-CO', $graph['inLanguage'] );
		// No honest single range exists: the price grows with rooms, distance and extras.
		self::assertArrayNotHasKey( 'priceRange', $graph );
		self::assertSame(
			[
				[
					'@type' => 'City',
					'name'  => 'Barranquilla',
				],
				[
					'@type' => 'City',
					'name'  => 'Cartagena',
				],
				[
					'@type' => 'City',
					'name'  => 'Santa Marta',
				],
			],
			$graph['areaServed']
		);
	}

	public function test_includes_the_phone_address_and_hours_when_set(): void {
		$graph = self::graph(
			[
				'business_phone'       => '570000000099',
				'business_street'      => 'Calle 00 # 00-00',
				'business_city'        => 'Barranquilla',
				'business_hours_open'  => '07:00',
				'business_hours_close' => '18:00',
			]
		);
		self::assertSame( '+570000000099', $graph['telephone'] );
		self::assertSame(
			[
				'@type'           => 'PostalAddress',
				'streetAddress'   => 'Calle 00 # 00-00',
				'addressLocality' => 'Barranquilla',
				'addressCountry'  => 'CO',
			],
			$graph['address']
		);
		self::assertSame(
			[
				[
					'@type'     => 'OpeningHoursSpecification',
					'dayOfWeek' => [ 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ],
					'opens'     => '07:00',
					'closes'    => '18:00',
				],
			],
			$graph['openingHoursSpecification']
		);
	}

	public function test_omits_every_blank_business_field(): void {
		$graph = self::graph( [ 'business_street' => 'Calle 00 # 00-00' ] );
		self::assertArrayNotHasKey( 'telephone', $graph );
		self::assertArrayNotHasKey( 'address', $graph );
		self::assertArrayNotHasKey( 'openingHoursSpecification', $graph );
	}

	public function test_the_script_element_cannot_be_closed_by_a_setting(): void {
		$script = BusinessSchema::script(
			self::graph(
				[
					'business_street' => '</script><script>alert(1)</script>',
					'business_city'   => 'Barranquilla',
				]
			)
		);
		self::assertStringStartsWith( '<script type="application/ld+json">', $script );
		self::assertSame( 1, substr_count( $script, '</script>' ) );
		self::assertStringContainsString( '\\u003C/script\\u003E', $script );
		$json = substr( $script, strlen( '<script type="application/ld+json">' ), -strlen( "</script>\n" ) );
		/** @var array{address: array{streetAddress: string}} $decoded */
		$decoded = json_decode( $json, true, 512, JSON_THROW_ON_ERROR );
		self::assertSame( '</script><script>alert(1)</script>', $decoded['address']['streetAddress'] );
	}
}
