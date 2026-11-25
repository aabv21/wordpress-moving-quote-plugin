<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

/**
 * `[moving_quote_start quote="get-a-quote"]`: the quote's first questions, for a home page's hero.
 * A plain GET form to the quote page, whose form arrives prefilled (`Prefill`) and shows the price.
 */
final class StartShortcode {
	public const TAG = 'moving_quote_start';

	public static function register(): void {
		add_shortcode( self::TAG, [ self::class, 'render' ] );
	}

	/** @param array<string, string>|string $atts */
	public static function render( array|string $atts ): string {
		$parsed = shortcode_atts( [ 'quote' => 'get-a-quote' ], is_array( $atts ) ? $atts : [] );
		$action = Shortcode::page_url( (string) $parsed['quote'] );
		if ( null === $action ) {
			return '';
		}
		wp_enqueue_style( Shortcode::HANDLE );

		$cities = Shortcode::cities();
		$target = Prefill::form_target( $action );
		ob_start();
		?>
		<form class="moving-quote-start" method="get" action="<?php echo esc_url( $target['action'] ); ?>">
			<?php foreach ( $target['fields'] as $name => $value ) : ?>
				<input type="hidden" name="<?php echo esc_attr( $name ); ?>" value="<?php echo esc_attr( $value ); ?>" />
			<?php endforeach; ?>
			<h2 class="moving-quote-start__title"><?php esc_html_e( 'Start your quote', 'moving-quote' ); ?></h2>
			<p class="moving-quote-start__field">
				<label for="mq-start-type"><?php esc_html_e( 'What are you moving?', 'moving-quote' ); ?></label>
				<select id="mq-start-type" name="<?php echo esc_attr( Prefill::TYPE_ARG ); ?>">
					<?php foreach ( Shortcode::move_type_labels() as $value => $label ) : ?>
						<option value="<?php echo esc_attr( $value ); ?>"><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
			</p>
			<?php
			foreach ( [
				Prefill::FROM_ARG => __( 'Moving from', 'moving-quote' ),
				Prefill::TO_ARG   => __( 'Moving to', 'moving-quote' ),
			] as $name => $label ) :
				$field_id = 'mq-start-' . $name;
				?>
				<p class="moving-quote-start__field">
					<label for="<?php echo esc_attr( $field_id ); ?>"><?php echo esc_html( $label ); ?></label>
					<select id="<?php echo esc_attr( $field_id ); ?>" name="<?php echo esc_attr( $name ); ?>" required>
						<option value="" disabled selected><?php esc_html_e( 'Choose a city', 'moving-quote' ); ?></option>
						<?php foreach ( $cities as $city ) : ?>
							<option value="<?php echo esc_attr( $city ); ?>"><?php echo esc_html( $city ); ?></option>
						<?php endforeach; ?>
					</select>
				</p>
			<?php endforeach; ?>
			<button type="submit" class="moving-quote-start__button"><?php esc_html_e( 'See my price', 'moving-quote' ); ?></button>
		</form>
		<?php
		$html = ob_get_clean();
		return false !== $html ? $html : '';
	}
}
