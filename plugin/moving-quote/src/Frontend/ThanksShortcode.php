<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Settings\Options;

/**
 * `[moving_quote_thanks]`: the thank-you page's card. The reference comes from the query, shown
 * only in its exact shape (`ReferenceShortcode`); the route, date and estimate come from the
 * visitor's own session (`thank-you.js`), so the page never looks a lead up by its reference.
 */
final class ThanksShortcode {
	public const TAG     = 'moving_quote_thanks';
	private const HANDLE = 'moving-quote-thanks';

	public static function register(): void {
		add_action( 'init', [ self::class, 'register_assets' ] );
		add_shortcode( self::TAG, [ self::class, 'render' ] );
	}

	public static function register_assets(): void {
		$script_url = plugins_url( 'assets/thank-you.js', \dirname( __DIR__, 2 ) . '/moving-quote.php' );
		if ( '' === $script_url ) {
			return;
		}
		wp_register_script(
			self::HANDLE,
			$script_url,
			[],
			\Chivabox\MovingQuote\Plugin::VERSION,
			[
				'in_footer' => true,
				'strategy'  => 'defer',
			]
		);
	}

	/**
	 * `heading="0"` leaves out the card's own "Request received" title, for a page whose title
	 * already says it.
	 *
	 * @param array<string, string>|string $atts
	 */
	public static function render( array|string $atts = [] ): string {
		$parsed = shortcode_atts( [ 'heading' => '1' ], is_array( $atts ) ? $atts : [] );
		wp_enqueue_script( self::HANDLE );
		wp_enqueue_style( Shortcode::HANDLE );

		$reference = ReferenceShortcode::reference();
		$business  = Options::business();
		$text      = null === $reference ? '' : sprintf(
			/* translators: %s: the lead's reference, e.g. MQ-1A2B3C4D */
			__( 'Hello, my reference is %s.', 'moving-quote' ),
			$reference
		);

		ob_start();
		?>
		<div class="moving-quote-thanks" data-thanks>
			<svg class="moving-quote-thanks__icon" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" /><path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
			<?php if ( '0' !== $parsed['heading'] ) : ?>
				<h2 class="moving-quote-thanks__title"><?php esc_html_e( 'Request received', 'moving-quote' ); ?></h2>
			<?php endif; ?>
			<?php echo ReferenceShortcode::render(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- ReferenceShortcode::render() escapes its own output. ?>
			<dl class="moving-quote-thanks__summary" data-thanks-summary hidden>
				<div><dt><?php esc_html_e( 'Route', 'moving-quote' ); ?></dt><dd data-thanks-route></dd></div>
				<div><dt><?php esc_html_e( 'Move date', 'moving-quote' ); ?></dt><dd data-thanks-date></dd></div>
				<div><dt><?php esc_html_e( 'Estimate', 'moving-quote' ); ?></dt><dd data-thanks-estimate></dd></div>
			</dl>
			<?php if ( $business->has_whatsapp() ) : ?>
				<a class="moving-quote-thanks__whatsapp" href="<?php echo esc_url( $business->whatsapp_href( $text ) ); ?>"><?php esc_html_e( 'Write to us on WhatsApp', 'moving-quote' ); ?></a>
			<?php endif; ?>
		</div>
		<?php
		$html = ob_get_clean();
		return false !== $html ? $html : '';
	}
}
