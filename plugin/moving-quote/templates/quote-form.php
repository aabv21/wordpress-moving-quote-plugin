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
// America/Bogota, like LeadValidator::validate_move_date(), not the site timezone, so min always
// matches what the REST API accepts.
$today        = ( new DateTimeImmutable( 'now', new DateTimeZone( 'America/Bogota' ) ) )->format( 'Y-m-d' );
$encoded_json = wp_json_encode( $config );
$config_json  = false !== $encoded_json ? $encoded_json : '{}';
?>
<form class="moving-quote" data-moving-quote data-config="<?php echo esc_attr( $config_json ); ?>" novalidate>
	<noscript>
		<p class="moving-quote__noscript"><?php esc_html_e( 'This form needs JavaScript to show a live estimate and submit your request. Please enable JavaScript, or call us for a quote.', 'moving-quote' ); ?></p>
	</noscript>

	<?php // role="list" keeps the list semantics Safari drops from an <ol> styled with list-style: none. ?>
	<ol class="moving-quote__progress" role="list">
		<?php foreach ( $steps as $index => $label ) : ?>
			<li class="moving-quote__progress-step" data-progress-step="<?php echo esc_attr( (string) $index ); ?>"<?php echo 0 === $index ? ' aria-current="step"' : ''; ?>>
				<span class="moving-quote__progress-marker" aria-hidden="true"><?php echo esc_html( (string) ( $index + 1 ) ); ?></span>
				<span class="moving-quote__progress-label"><?php echo esc_html( $label ); ?></span>
			</li>
		<?php endforeach; ?>
	</ol>

	<?php // Hidden from sight, Tab order, and assistive technology: only a bot filling fields by DOM access reaches it. ?>
	<p class="moving-quote__honeypot moving-quote__offscreen" aria-hidden="true">
		<label for="mq-website"><?php esc_html_e( 'Leave this field empty', 'moving-quote' ); ?></label>
		<input type="text" id="mq-website" name="website" tabindex="-1" autocomplete="off" />
	</p>

	<fieldset class="moving-quote__step" data-step="0">
		<legend class="moving-quote__legend" tabindex="-1"><?php echo esc_html( $steps[0] ); ?></legend>

		<div class="moving-quote__fields">
			<p class="moving-quote__field">
				<label class="moving-quote__label" for="mq-move-type"><?php esc_html_e( 'What are you moving?', 'moving-quote' ); ?></label>
				<select class="moving-quote__control" id="mq-move-type" name="move_type" required aria-describedby="mq-error-move_type">
					<?php foreach ( $move_types as $value => $label ) : ?>
						<option value="<?php echo esc_attr( $value ); ?>"><?php echo esc_html( $label ); ?></option>
					<?php endforeach; ?>
				</select>
				<span class="moving-quote__error" id="mq-error-move_type" data-error-for="move_type"></span>
			</p>

			<p class="moving-quote__field">
				<label class="moving-quote__label" for="mq-rooms"><?php esc_html_e( 'How many rooms?', 'moving-quote' ); ?></label>
				<select class="moving-quote__control" id="mq-rooms" name="rooms" required aria-describedby="mq-error-rooms">
					<?php for ( $room = 1; $room <= 5; $room++ ) : ?>
						<option value="<?php echo esc_attr( (string) $room ); ?>"><?php echo 5 === $room ? esc_html__( '5+', 'moving-quote' ) : esc_html( (string) $room ); ?></option>
					<?php endfor; ?>
				</select>
				<span class="moving-quote__error" id="mq-error-rooms" data-error-for="rooms"></span>
			</p>

			<p class="moving-quote__field">
				<label class="moving-quote__label" for="mq-origin"><?php esc_html_e( 'Moving from', 'moving-quote' ); ?></label>
				<select class="moving-quote__control" id="mq-origin" name="origin" required aria-describedby="mq-error-origin">
					<option value="" disabled selected><?php esc_html_e( 'Choose a city', 'moving-quote' ); ?></option>
					<?php foreach ( $cities as $city ) : ?>
						<option value="<?php echo esc_attr( $city ); ?>"><?php echo esc_html( $city ); ?></option>
					<?php endforeach; ?>
				</select>
				<span class="moving-quote__error" id="mq-error-origin" data-error-for="origin"></span>
			</p>

			<p class="moving-quote__field">
				<label class="moving-quote__label" for="mq-destination"><?php esc_html_e( 'Moving to', 'moving-quote' ); ?></label>
				<select class="moving-quote__control" id="mq-destination" name="destination" required aria-describedby="mq-error-destination">
					<option value="" disabled selected><?php esc_html_e( 'Choose a city', 'moving-quote' ); ?></option>
					<?php foreach ( $cities as $city ) : ?>
						<option value="<?php echo esc_attr( $city ); ?>"><?php echo esc_html( $city ); ?></option>
					<?php endforeach; ?>
				</select>
				<span class="moving-quote__error" id="mq-error-destination" data-error-for="destination"></span>
			</p>

			<p class="moving-quote__field">
				<label class="moving-quote__label" for="mq-move-date"><?php esc_html_e( 'Move date', 'moving-quote' ); ?></label>
				<input class="moving-quote__control" type="date" id="mq-move-date" name="move_date" required min="<?php echo esc_attr( $today ); ?>" aria-describedby="mq-error-move_date" />
				<span class="moving-quote__error" id="mq-error-move_date" data-error-for="move_date"></span>
			</p>
		</div>

		<div class="moving-quote__actions">
			<button type="button" class="moving-quote__button moving-quote__button--primary" data-next><?php esc_html_e( 'Next', 'moving-quote' ); ?></button>
		</div>
	</fieldset>

	<fieldset class="moving-quote__step" data-step="1" hidden>
		<legend class="moving-quote__legend" tabindex="-1"><?php echo esc_html( $steps[1] ); ?></legend>

		<p class="moving-quote__intro"><?php esc_html_e( 'Choose any you need. Each one is added to your estimate.', 'moving-quote' ); ?></p>

		<div class="moving-quote__options">
			<?php foreach ( $extras as $value => $label ) : ?>
				<p class="moving-quote__option">
					<label class="moving-quote__check" for="mq-extra-<?php echo esc_attr( $value ); ?>">
						<input class="moving-quote__checkbox" type="checkbox" id="mq-extra-<?php echo esc_attr( $value ); ?>" name="extras" value="<?php echo esc_attr( $value ); ?>" />
						<span><?php echo esc_html( $label ); ?></span>
					</label>
				</p>
			<?php endforeach; ?>
		</div>

		<div class="moving-quote__actions">
			<button type="button" class="moving-quote__button moving-quote__button--secondary" data-back><?php esc_html_e( 'Back', 'moving-quote' ); ?></button>
			<button type="button" class="moving-quote__button moving-quote__button--primary" data-next><?php esc_html_e( 'Next', 'moving-quote' ); ?></button>
		</div>
	</fieldset>

	<fieldset class="moving-quote__step" data-step="2" hidden>
		<legend class="moving-quote__legend" tabindex="-1"><?php echo esc_html( $steps[2] ); ?></legend>

		<div class="moving-quote__fields">
			<p class="moving-quote__field moving-quote__field--wide">
				<label class="moving-quote__label" for="mq-name"><?php esc_html_e( 'Full name', 'moving-quote' ); ?></label>
				<input class="moving-quote__control" type="text" id="mq-name" name="name" required minlength="2" maxlength="100" autocomplete="name" aria-describedby="mq-error-name" />
				<span class="moving-quote__error" id="mq-error-name" data-error-for="name"></span>
			</p>

			<p class="moving-quote__field">
				<label class="moving-quote__label" for="mq-phone"><?php esc_html_e( 'Phone', 'moving-quote' ); ?></label>
				<input class="moving-quote__control" type="tel" id="mq-phone" name="phone" required autocomplete="tel" aria-describedby="mq-error-phone" />
				<span class="moving-quote__error" id="mq-error-phone" data-error-for="phone"></span>
			</p>

			<p class="moving-quote__field">
				<label class="moving-quote__label" for="mq-email"><?php esc_html_e( 'Email', 'moving-quote' ); ?></label>
				<input class="moving-quote__control" type="email" id="mq-email" name="email" required autocomplete="email" spellcheck="false" aria-describedby="mq-error-email" />
				<span class="moving-quote__error" id="mq-error-email" data-error-for="email"></span>
			</p>

			<p class="moving-quote__field moving-quote__field--wide">
				<label class="moving-quote__check moving-quote__check--plain" for="mq-consent">
					<input class="moving-quote__checkbox" type="checkbox" id="mq-consent" name="consent" value="1" required aria-describedby="mq-error-consent" />
					<span>
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
					</span>
				</label>
				<span class="moving-quote__error" id="mq-error-consent" data-error-for="consent"></span>
			</p>
		</div>

		<div class="moving-quote__actions">
			<button type="button" class="moving-quote__button moving-quote__button--secondary" data-back><?php esc_html_e( 'Back', 'moving-quote' ); ?></button>
			<button type="submit" class="moving-quote__button moving-quote__button--cta" data-submit><?php esc_html_e( 'Send my request', 'moving-quote' ); ?></button>
		</div>
	</fieldset>

	<p class="moving-quote__form-error" data-form-error role="alert"></p>

	<div class="moving-quote__success" data-success tabindex="-1" hidden>
		<svg class="moving-quote__success-icon" viewBox="0 0 24 24" width="40" height="40" aria-hidden="true" focusable="false">
			<circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
			<path d="m7.5 12.5 3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
		</svg>
		<p class="moving-quote__success-title"><?php esc_html_e( 'Request received', 'moving-quote' ); ?></p>
		<p><?php esc_html_e( 'Thank you! A member of our team will call you to confirm the details and the final price.', 'moving-quote' ); ?></p>
		<p data-success-reference hidden>
			<?php
			echo wp_kses(
				sprintf(
					/* translators: %s: a <strong> placeholder that quote-form.ts fills in with the lead's MQ-… reference */
					__( 'Your reference number is %s.', 'moving-quote' ),
					'<strong data-success-reference-value translate="no"></strong>'
				),
				[
					'strong' => [
						'data-success-reference-value' => true,
						'translate'                    => true,
					],
				]
			);
			?>
		</p>
	</div>

	<div class="moving-quote__estimate" data-estimate-state="idle">
		<div class="moving-quote__estimate-result" data-estimate-result aria-live="polite" aria-atomic="true">
			<p class="moving-quote__estimate-label"><?php esc_html_e( 'Estimated price', 'moving-quote' ); ?></p>
			<p class="moving-quote__estimate-value" data-estimate-value>&mdash;</p>
			<p class="moving-quote__estimate-error" data-estimate-error hidden><?php esc_html_e( 'We couldn’t calculate a price for this move right now. You can still send your request, and we’ll quote it for you.', 'moving-quote' ); ?></p>
		</div>
		<p class="moving-quote__estimate-hint" data-estimate-hint><?php esc_html_e( 'Choose what you are moving, the rooms, and both cities to see a price.', 'moving-quote' ); ?></p>
		<p class="moving-quote__disclaimer"><?php esc_html_e( 'This is an estimate. We confirm the final price after a visit or video call.', 'moving-quote' ); ?></p>
	</div>
</form>
