<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Leads\LeadRecord;

/**
 * Echoes `?reference=` only in the exact `LeadRecord::reference_for()` shape, and never looks it
 * up, so the page can't probe which references exist. Renders nothing without one.
 */
final class ReferenceShortcode {
	public const TAG       = 'moving_quote_reference';
	public const QUERY_ARG = 'reference';

	public static function register(): void {
		add_shortcode( self::TAG, [ self::class, 'render' ] );
	}

	public static function render(): string {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only display of a value validated against a fixed pattern below; nothing changes state.
		$value = $_GET[ self::QUERY_ARG ] ?? null;
		if ( ! is_string( $value ) ) {
			return '';
		}
		$raw       = wp_unslash( $value );
		$reference = sanitize_text_field( $raw );
		// A value sanitizing changed was never a reference, even if the rest would match.
		if ( $reference !== $raw || ! LeadRecord::is_reference( $reference ) ) {
			return '';
		}

		// Inline: this page doesn't load the form's stylesheet, and a narrow screen would break
		// "MQ-" from its digits.
		return sprintf(
			'<p class="moving-quote-reference">%s</p>',
			sprintf(
				/* translators: %s: the lead's reference, e.g. MQ-1A2B3C4D */
				esc_html__( 'Your reference number is %s. Keep it handy if you contact us about your move.', 'moving-quote' ),
				'<strong translate="no" style="white-space: nowrap">' . esc_html( $reference ) . '</strong>'
			)
		);
	}
}
