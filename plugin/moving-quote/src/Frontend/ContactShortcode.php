<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Settings\{Business, Options};

/**
 * `[moving_quote_contact]`: the business details from Settings, for a theme's footer or header.
 * Each line shows only when its field is set, so a fresh install prints nothing empty.
 */
final class ContactShortcode {
	public const TAG = 'moving_quote_contact';

	public static function register(): void {
		add_shortcode( self::TAG, [ self::class, 'render' ] );
	}

	/**
	 * `layout="footer"` (the default) is the full contact block; `layout="whatsapp"` and
	 * `layout="phone"` are one link each.
	 *
	 * @param array<string, string>|string $atts
	 */
	public static function render( array|string $atts ): string {
		$parsed   = shortcode_atts( [ 'layout' => 'footer' ], is_array( $atts ) ? $atts : [] );
		$business = Options::business();

		return match ( $parsed['layout'] ) {
			'whatsapp' => self::whatsapp( $business ),
			'phone'    => self::phone( $business ),
			default    => self::footer( $business, Shortcode::privacy_url() ),
		};
	}

	private static function phone( Business $business ): string {
		if ( ! $business->has_phone() ) {
			return '';
		}
		return sprintf( '<a class="moving-quote-contact__phone" href="%s">%s</a>', esc_url( $business->tel_href() ), esc_html( $business->phone_display() ) );
	}

	private static function whatsapp( Business $business ): string {
		if ( ! $business->has_whatsapp() ) {
			return '';
		}
		return sprintf( '<a class="moving-quote-contact__whatsapp" href="%s">%s</a>', esc_url( $business->whatsapp_href() ), esc_html__( 'WhatsApp', 'moving-quote' ) );
	}

	private static function footer( Business $business, ?string $privacy_url ): string {
		$lines = [];
		if ( $business->has_phone() ) {
			$lines[] = self::phone( $business );
		}
		if ( $business->has_whatsapp() ) {
			$lines[] = self::whatsapp( $business );
		}
		if ( $business->has_address() ) {
			$lines[] = sprintf( '<span class="moving-quote-contact__address">%s, %s</span>', esc_html( $business->street ), esc_html( $business->city ) );
		}
		if ( $business->has_hours() ) {
			$lines[] = sprintf(
				'<span class="moving-quote-contact__hours">%s</span>',
				esc_html(
					sprintf(
						/* translators: 1: opening time, 2: closing time, both HH:MM */
						__( 'Monday to Saturday, %1$s to %2$s', 'moving-quote' ),
						$business->hours_open,
						$business->hours_close
					)
				)
			);
		}
		if ( '' !== $business->tax_id ) {
			$lines[] = sprintf( '<span class="moving-quote-contact__tax-id">%s</span>', esc_html( $business->tax_id ) );
		}
		// No business detail at all: no block, rather than an address holding only the policy link.
		if ( [] === $lines ) {
			return '';
		}
		if ( null !== $privacy_url ) {
			$lines[] = sprintf( '<a class="moving-quote-contact__policy" href="%s">%s</a>', esc_url( $privacy_url ), esc_html__( 'Data processing policy', 'moving-quote' ) );
		}

		return '<address class="moving-quote-contact">' . implode( '', $lines ) . '</address>';
	}
}
