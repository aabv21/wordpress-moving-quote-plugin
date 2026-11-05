<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Pricing\DistanceTable;
use Chivabox\MovingQuote\Settings\Options;

/**
 * Registers assets on `init` but enqueues them from `render()`, so they load only where used.
 */
final class Shortcode {
	public const TAG     = 'moving_quote';
	private const HANDLE = 'moving-quote-form';

	public static function register(): void {
		add_action( 'init', [ self::class, 'register_assets' ] );
		add_shortcode( self::TAG, [ self::class, 'render' ] );
	}

	public static function register_assets(): void {
		$script_url = self::asset_url( 'assets/quote-form.js' );
		if ( '' !== $script_url ) {
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

		$style_url = self::asset_url( 'assets/quote-form.css' );
		if ( '' !== $style_url ) {
			wp_register_style( self::HANDLE, $style_url, [], \Chivabox\MovingQuote\Plugin::VERSION );
		}
	}

	private static function asset_url( string $path ): string {
		return plugins_url( $path, self::plugin_file() );
	}

	/**
	 * @param array<string, string>|string $atts
	 */
	public static function render( array|string $atts ): string {
		wp_enqueue_script( self::HANDLE );
		wp_enqueue_style( self::HANDLE );

		$parsed = shortcode_atts( [ 'thank_you' => 'thank-you' ], is_array( $atts ) ? $atts : [] );

		// Local variables for templates/quote-form.php, included below: $cities and $config.
		$cities = self::cities();
		$config = self::config( (string) $parsed['thank_you'] );

		ob_start();
		include self::template_path();
		$html = ob_get_clean();

		return false !== $html ? $html : '';
	}

	/** @return list<string> */
	public static function cities(): array {
		return DistanceTable::from_settings( Options::all() )->cities();
	}

	/**
	 * Null when the page doesn't exist. get_permalink() returns false only for a missing post,
	 * which the null check already rules out.
	 */
	public static function thank_you_url( string $slug ): ?string {
		$page = get_page_by_path( $slug );
		return null !== $page ? get_permalink( $page ) : null;
	}

	/**
	 * Holds only strings the script writes itself; text the template renders stays there.
	 *
	 * @return array{
	 *     estimateUrl: string,
	 *     leadsUrl: string,
	 *     nonce: string,
	 *     thankYouUrl: string|null,
	 *     strings: array{
	 *         sending: string,
	 *         networkError: string,
	 *         rateLimited: string,
	 *         sessionExpired: string,
	 *         genericError: string,
	 *     },
	 * }
	 */
	public static function config( string $thank_you_slug ): array {
		return [
			'estimateUrl' => rest_url( 'moving-quote/v1/estimate' ),
			'leadsUrl'    => rest_url( 'moving-quote/v1/leads' ),
			'nonce'       => wp_create_nonce( 'wp_rest' ),
			'thankYouUrl' => self::thank_you_url( $thank_you_slug ),
			'strings'     => [
				'sending'        => __( 'Sending…', 'moving-quote' ),
				'networkError'   => __( 'Something went wrong. Please check your connection and try again.', 'moving-quote' ),
				'rateLimited'    => __( 'Too many requests. Please try again later.', 'moving-quote' ),
				'sessionExpired' => __( 'Your session expired. Reload the page and try again.', 'moving-quote' ),
				'genericError'   => __( 'Please fix the highlighted fields.', 'moving-quote' ),
			],
		];
	}

	private static function template_path(): string {
		return \dirname( __DIR__, 2 ) . '/templates/quote-form.php';
	}

	private static function plugin_file(): string {
		return \dirname( __DIR__, 2 ) . '/moving-quote.php';
	}
}
