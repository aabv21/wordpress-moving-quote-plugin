<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

/**
 * Sends one signed lead delivery over HTTP. Uses `wp_remote_post()`, not `wp_safe_remote_post()`,
 * because the admin sets the destination URL themselves, and it is a private Docker hostname that
 * the safe variant's SSRF protections would otherwise block.
 */
final class WebhookClient {
	private const TIMEOUT_SECONDS      = 5;
	private const ERROR_EXCERPT_LENGTH = 200;

	/** Sends the signed request. Returns null on an acknowledged 2xx, otherwise the error text. */
	public static function send( string $url, string $jwt, string $body ): ?string {
		$response = wp_remote_post(
			$url,
			[
				'timeout'     => self::TIMEOUT_SECONDS,
				'redirection' => 0,
				'data_format' => 'body',
				'headers'     => [
					'Authorization' => 'Bearer ' . $jwt,
					'Content-Type'  => 'application/json',
				],
				'body'        => $body,
			]
		);

		if ( is_wp_error( $response ) ) {
			return $response->get_error_message();
		}

		// wp_remote_retrieve_response_code() is typed int|string (empty string on a malformed
		// response); is_wp_error() above already ruled out the one case that leaves it unset.
		$status        = (int) wp_remote_retrieve_response_code( $response );
		$response_body = wp_remote_retrieve_body( $response );

		if ( $status < 200 || $status > 299 ) {
			return "HTTP {$status}: " . self::excerpt( $response_body );
		}

		if ( ResponseCheck::acknowledged( $status, $response_body ) ) {
			return null;
		}

		return "Unexpected response (HTTP {$status}): " . self::excerpt( $response_body );
	}

	/** Strips tags first, so an HTML error page (a load balancer's own 502, for example) doesn't fill `last_error` with markup. */
	private static function excerpt( string $body ): string {
		return mb_substr( trim( wp_strip_all_tags( $body ) ), 0, self::ERROR_EXCERPT_LENGTH );
	}
}
