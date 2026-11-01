<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Rest;

use Chivabox\MovingQuote\Pricing\Estimate;

/** Translatable, customer-facing text for the REST endpoints. */
final class Messages {
	/** The display text for a field-validation error code. */
	public static function field( string $code ): string {
		$messages = [
			'required'         => __( 'This field is required.', 'moving-quote' ),
			'invalid'          => __( 'Please check this value.', 'moving-quote' ),
			'unknown_city'     => __( 'Choose a city from the list.', 'moving-quote' ),
			'unknown_route'    => __( "We don't have a price for this route yet. Please call us.", 'moving-quote' ),
			'too_short'        => __( 'Please enter at least 2 characters.', 'moving-quote' ),
			'too_long'         => __( 'Please use 100 characters or fewer.', 'moving-quote' ),
			'past_date'        => __( 'Choose today or a later date.', 'moving-quote' ),
			'too_far'          => __( 'Choose a date within the next 12 months.', 'moving-quote' ),
			'consent_required' => __( 'Please accept the privacy policy to continue.', 'moving-quote' ),
		];

		return $messages[ $code ] ?? $code;
	}

	/** The estimate range, formatted for display: `COP 1,017,000 – 1,243,000`. */
	public static function display( Estimate $estimate ): string {
		return sprintf(
			/* translators: 1: low estimate, 2: high estimate */
			__( 'COP %1$s – %2$s', 'moving-quote' ),
			number_format_i18n( $estimate->low ),
			number_format_i18n( $estimate->high )
		);
	}
}
