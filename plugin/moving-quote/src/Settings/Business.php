<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Settings;

/**
 * The business details from Settings, as the site shows them. Pure. Every field may be blank, and
 * each link helper answers `''` then, so no page prints a `tel:` or `wa.me` link to nothing.
 *
 * @phpstan-import-type SettingsShape from Defaults
 */
final readonly class Business {
	public function __construct(
		public string $phone,
		public string $whatsapp,
		public string $street,
		public string $city,
		public string $hours_open,
		public string $hours_close,
		public string $tax_id
	) {
	}

	/** @param SettingsShape $settings */
	public static function from_settings( array $settings ): self {
		return new self(
			$settings['business_phone'],
			$settings['business_whatsapp'],
			$settings['business_street'],
			$settings['business_city'],
			$settings['business_hours_open'],
			$settings['business_hours_close'],
			$settings['business_tax_id']
		);
	}

	public function has_phone(): bool {
		return '' !== $this->phone;
	}

	public function has_whatsapp(): bool {
		return '' !== $this->whatsapp;
	}

	public function has_address(): bool {
		return '' !== $this->street && '' !== $this->city;
	}

	public function has_hours(): bool {
		return '' !== $this->hours_open && '' !== $this->hours_close;
	}

	/** `570000000099` → `+57 000 000 0099`; any other number is `+` and its digits. */
	public function phone_display(): string {
		return self::display( $this->phone );
	}

	public static function display( string $digits ): string {
		if ( '' === $digits ) {
			return '';
		}
		if ( 12 === strlen( $digits ) && str_starts_with( $digits, '57' ) ) {
			return sprintf( '+57 %s %s %s', substr( $digits, 2, 3 ), substr( $digits, 5, 3 ), substr( $digits, 8 ) );
		}
		return '+' . $digits;
	}

	public function tel_href(): string {
		return $this->has_phone() ? 'tel:+' . $this->phone : '';
	}

	/** With `$text`, the chat opens with that message typed in. */
	public function whatsapp_href( string $text = '' ): string {
		if ( ! $this->has_whatsapp() ) {
			return '';
		}
		$href = 'https://wa.me/' . $this->whatsapp;
		return '' === $text ? $href : $href . '?text=' . rawurlencode( $text );
	}
}
