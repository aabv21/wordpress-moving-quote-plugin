<?php
/**
 * The `[moving_quote]` form markup. Included by Frontend\Shortcode::render(), which sets
 * `$cities` (list<string>) and `$config` (the data-config payload) in this file's scope.
 *
 * @package Chivabox\MovingQuote
 *
 * @var list<string> $cities
 * @var array{estimateUrl: string, leadsUrl: string, nonce: string, thankYouUrl: string|null, strings: array<string, string>} $config
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

$move_types = [
	'apartment' => __( 'Apartment', 'moving-quote' ),
	'house'     => __( 'House', 'moving-quote' ),
	'office'    => __( 'Office', 'moving-quote' ),
];

$extras = [
	'packing'            => __( 'Packing', 'moving-quote' ),
	'furniture_assembly' => __( 'Furniture disassembly and assembly', 'moving-quote' ),
	'storage'            => __( 'Temporary storage', 'moving-quote' ),
	'piano_fragile'      => __( 'Piano or fragile items', 'moving-quote' ),
];

$steps = [
	__( 'Your move', 'moving-quote' ),
	__( 'Extra services', 'moving-quote' ),
	__( 'Your details', 'moving-quote' ),
];

$privacy_url = get_privacy_policy_url();
// The server rule (Leads\LeadValidator::validate_move_date(), called with a hardcoded
// America/Bogota zone, not the site's own configured timezone) computes "today" the same way, so
// the date input's own min can never fall a day behind or ahead of what the REST API will accept.
$today        = ( new DateTimeImmutable( 'now', new DateTimeZone( 'America/Bogota' ) ) )->format( 'Y-m-d' );
$encoded_json = wp_json_encode( $config );
$config_json  = false !== $encoded_json ? $encoded_json : '{}';
?>
<form class="moving-quote" data-moving-quote data-config="<?php echo esc_attr( $config_json ); ?>" novalidate>
	<noscript>
		<p><?php esc_html_e( 'This form needs JavaScript to show a live estimate and submit your request. Please enable JavaScript, or call us for a quote.', 'moving-quote' ); ?></p>
	</noscript>

	<ol class="moving-quote__progress">
		<?php foreach ( $steps as $index => $label ) : ?>
			<li data-progress-step="<?php echo esc_attr( (string) $index ); ?>"<?php echo 0 === $index ? ' aria-current="step"' : ''; ?>>
				<?php echo esc_html( $label ); ?>
			</li>
		<?php endforeach; ?>
	</ol>

	<p class="moving-quote__honeypot moving-quote__offscreen">
		<label for="mq-website"><?php esc_html_e( 'Leave this field empty', 'moving-quote' ); ?></label>
		<input type="text" id="mq-website" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" />
	</p>

	<fieldset data-step="0">
		<legend tabindex="-1"><?php echo esc_html( $steps[0] ); ?></legend>

		<p>
			<label for="mq-move-type"><?php esc_html_e( 'What are you moving?', 'moving-quote' ); ?></label>
			<select id="mq-move-type" name="move_type" required aria-describedby="mq-error-move_type">
				<?php foreach ( $move_types as $value => $label ) : ?>
					<option value="<?php echo esc_attr( $value ); ?>"><?php echo esc_html( $label ); ?></option>
				<?php endforeach; ?>
			</select>
			<span class="moving-quote__error" id="mq-error-move_type" data-error-for="move_type"></span>
		</p>

		<p>
			<label for="mq-rooms"><?php esc_html_e( 'How many rooms?', 'moving-quote' ); ?></label>
			<select id="mq-rooms" name="rooms" required aria-describedby="mq-error-rooms">
				<?php for ( $room = 1; $room <= 5; $room++ ) : ?>
					<option value="<?php echo esc_attr( (string) $room ); ?>"><?php echo 5 === $room ? esc_html__( '5+', 'moving-quote' ) : esc_html( (string) $room ); ?></option>
				<?php endfor; ?>
			</select>
			<span class="moving-quote__error" id="mq-error-rooms" data-error-for="rooms"></span>
		</p>

		<p>
			<label for="mq-origin"><?php esc_html_e( 'Moving from', 'moving-quote' ); ?></label>
			<select id="mq-origin" name="origin" required aria-describedby="mq-error-origin">
				<option value="" disabled selected><?php esc_html_e( 'Choose a city', 'moving-quote' ); ?></option>
				<?php foreach ( $cities as $city ) : ?>
					<option value="<?php echo esc_attr( $city ); ?>"><?php echo esc_html( $city ); ?></option>
				<?php endforeach; ?>
			</select>
			<span class="moving-quote__error" id="mq-error-origin" data-error-for="origin"></span>
		</p>

		<p>
			<label for="mq-destination"><?php esc_html_e( 'Moving to', 'moving-quote' ); ?></label>
			<select id="mq-destination" name="destination" required aria-describedby="mq-error-destination">
				<option value="" disabled selected><?php esc_html_e( 'Choose a city', 'moving-quote' ); ?></option>
				<?php foreach ( $cities as $city ) : ?>
					<option value="<?php echo esc_attr( $city ); ?>"><?php echo esc_html( $city ); ?></option>
				<?php endforeach; ?>
			</select>
			<span class="moving-quote__error" id="mq-error-destination" data-error-for="destination"></span>
		</p>

		<p>
			<label for="mq-move-date"><?php esc_html_e( 'Move date', 'moving-quote' ); ?></label>
			<input type="date" id="mq-move-date" name="move_date" required min="<?php echo esc_attr( $today ); ?>" aria-describedby="mq-error-move_date" />
			<span class="moving-quote__error" id="mq-error-move_date" data-error-for="move_date"></span>
		</p>

		<button type="button" data-next><?php esc_html_e( 'Next', 'moving-quote' ); ?></button>
	</fieldset>

	<fieldset data-step="1" hidden>
		<legend tabindex="-1"><?php echo esc_html( $steps[1] ); ?></legend>

		<?php foreach ( $extras as $value => $label ) : ?>
			<p>
				<label for="mq-extra-<?php echo esc_attr( $value ); ?>">
					<input type="checkbox" id="mq-extra-<?php echo esc_attr( $value ); ?>" name="extras" value="<?php echo esc_attr( $value ); ?>" />
					<?php echo esc_html( $label ); ?>
				</label>
			</p>
		<?php endforeach; ?>

		<button type="button" data-back><?php esc_html_e( 'Back', 'moving-quote' ); ?></button>
		<button type="button" data-next><?php esc_html_e( 'Next', 'moving-quote' ); ?></button>
	</fieldset>

	<fieldset data-step="2" hidden>
		<legend tabindex="-1"><?php echo esc_html( $steps[2] ); ?></legend>

		<p>
			<label for="mq-name"><?php esc_html_e( 'Full name', 'moving-quote' ); ?></label>
			<input type="text" id="mq-name" name="name" required minlength="2" maxlength="100" aria-describedby="mq-error-name" />
			<span class="moving-quote__error" id="mq-error-name" data-error-for="name"></span>
		</p>

		<p>
			<label for="mq-phone"><?php esc_html_e( 'Phone', 'moving-quote' ); ?></label>
			<input type="tel" id="mq-phone" name="phone" required aria-describedby="mq-error-phone" />
			<span class="moving-quote__error" id="mq-error-phone" data-error-for="phone"></span>
		</p>

		<p>
			<label for="mq-email"><?php esc_html_e( 'Email', 'moving-quote' ); ?></label>
			<input type="email" id="mq-email" name="email" required aria-describedby="mq-error-email" />
			<span class="moving-quote__error" id="mq-error-email" data-error-for="email"></span>
		</p>

		<p>
			<label for="mq-consent">
				<input type="checkbox" id="mq-consent" name="consent" value="1" required aria-describedby="mq-error-consent" />
				<?php if ( '' !== $privacy_url ) : ?>
					<?php
					echo wp_kses(
						sprintf(
							/* translators: %s: privacy policy URL */
							__( 'I agree to the processing of my data under the <a href="%s">privacy policy</a>.', 'moving-quote' ),
							esc_url( $privacy_url )
						),
						[ 'a' => [ 'href' => true ] ]
					);
					?>
				<?php else : ?>
					<?php esc_html_e( 'I agree to the processing of my data under the privacy policy.', 'moving-quote' ); ?>
				<?php endif; ?>
			</label>
			<span class="moving-quote__error" id="mq-error-consent" data-error-for="consent"></span>
		</p>

		<button type="button" data-back><?php esc_html_e( 'Back', 'moving-quote' ); ?></button>
		<button type="submit" data-submit><?php esc_html_e( 'Get my estimate', 'moving-quote' ); ?></button>
	</fieldset>

	<div class="moving-quote__estimate" aria-live="polite">
		<?php
		echo wp_kses(
			sprintf(
				/* translators: %s: a <span> placeholder that quote-form.ts fills in with the price range */
				__( 'Estimated price: %s', 'moving-quote' ),
				'<span data-estimate-value>&mdash;</span>'
			),
			[ 'span' => [ 'data-estimate-value' => true ] ]
		);
		?>
		<p class="moving-quote__disclaimer"><?php esc_html_e( 'This is an estimate. We confirm the final price after a visit or video call.', 'moving-quote' ); ?></p>
	</div>

	<p class="moving-quote__form-error" data-form-error role="alert"></p>
</form>
