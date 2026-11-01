<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

/** Decides whether n8n's response to a lead delivery counts as delivered. */
final class ResponseCheck {
	/** True only for a 2xx whose JSON body has `status` `accepted` or `duplicate`. */
	public static function acknowledged( int $status, string $body ): bool {
		if ( $status < 200 || $status > 299 ) {
			return false;
		}

		$decoded = json_decode( $body, true );
		if ( ! is_array( $decoded ) || ! isset( $decoded['status'] ) ) {
			return false;
		}

		return in_array( $decoded['status'], [ 'accepted', 'duplicate' ], true );
	}
}
