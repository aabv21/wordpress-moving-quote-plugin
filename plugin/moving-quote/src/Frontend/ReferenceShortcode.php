<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Leads\LeadRecord;

/**
 * The `[moving_quote_reference]` shortcode, for the thank-you page: shows the lead's `MQ-…`
 * reference that the quote form appends to its redirect as `?reference=…`, and renders nothing
 * when the query string has none (a visitor opening the page directly, or a filled honeypot, which
 * is answered without a reference). The value is echoed back only when it has the exact shape
 * `LeadRecord::reference_for()` builds, and it is never looked up: the page confirms what the
 * visitor's own browser just received, and can't be used to probe which references exist.
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
		// The exact query value or nothing: a value sanitizing had to change (markup stripped, a
		// newline dropped) was never a reference, even if what's left would match the pattern.
		if ( $reference !== $raw || ! LeadRecord::is_reference( $reference ) ) {
			return '';
		}

		// The thank-you page doesn't load the quote form's stylesheet, so the one rule the reference
		// needs travels inline: without it, a narrow screen breaks "MQ-" from its digits.
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
