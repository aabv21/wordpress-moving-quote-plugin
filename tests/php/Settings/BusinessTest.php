<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Settings;

use Chivabox\MovingQuote\Settings\{Business, Defaults};
use PHPUnit\Framework\TestCase;

/**
 * @phpstan-import-type SettingsShape from Defaults
 */
final class BusinessTest extends TestCase {
	/** @param array<string, string> $overrides */
	private static function business( array $overrides = [] ): Business {
		/** @var SettingsShape $settings only business_* string keys are overridden */
		$settings = array_replace( Defaults::settings(), $overrides );
		return Business::from_settings( $settings );
	}

	public function test_formats_a_colombian_number_for_display(): void {
		self::assertSame( '+57 000 000 0099', self::business( [ 'business_phone' => '570000000099' ] )->phone_display() );
		self::assertSame( '+15551234567', self::business( [ 'business_phone' => '15551234567' ] )->phone_display() );
	}

	public function test_builds_tel_and_whatsapp_links(): void {
		$business = self::business(
			[
				'business_phone'    => '570000000099',
				'business_whatsapp' => '570000000099',
			]
		);
		self::assertSame( 'tel:+570000000099', $business->tel_href() );
		self::assertSame( 'https://wa.me/570000000099', $business->whatsapp_href() );
		self::assertSame( 'https://wa.me/570000000099?text=Hello%2C%20my%20reference%20is%20MQ-1A2B3C4D.', $business->whatsapp_href( 'Hello, my reference is MQ-1A2B3C4D.' ) );
	}

	public function test_blank_numbers_give_no_links(): void {
		$business = self::business();
		self::assertFalse( $business->has_phone() );
		self::assertFalse( $business->has_whatsapp() );
		self::assertSame( '', $business->tel_href() );
		self::assertSame( '', $business->whatsapp_href() );
		self::assertSame( '', $business->whatsapp_href( 'Hello' ) );
		self::assertSame( '', $business->phone_display() );
	}

	public function test_has_hours_only_with_both_ends(): void {
		self::assertTrue(
			self::business(
				[
					'business_hours_open'  => '07:00',
					'business_hours_close' => '18:00',
				]
			)->has_hours()
		);
		self::assertFalse( self::business( [ 'business_hours_open' => '07:00' ] )->has_hours() );
	}
}
