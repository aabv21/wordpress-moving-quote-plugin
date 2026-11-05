<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

final class JwtSigner {
	private const HEADER = [
		'alg' => 'HS256',
		'typ' => 'JWT',
	];

	/** @param array<string, mixed> $claims */
	public static function hs256( array $claims, string $secret ): string {
		$header_part   = self::base64_url_encode( self::json_encode( self::HEADER ) );
		$claims_part   = self::base64_url_encode( self::json_encode( $claims ) );
		$signing_input = $header_part . '.' . $claims_part;
		$signature     = hash_hmac( 'sha256', $signing_input, $secret, true );

		return $signing_input . '.' . self::base64_url_encode( $signature );
	}

	/** @param array<string, mixed> $value */
	private static function json_encode( array $value ): string {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- pure class; wp_json_encode() is unavailable without WordPress.
		return json_encode( $value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR );
	}

	private static function base64_url_encode( string $raw ): string {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- base64url transport encoding for a JWT segment, not code obfuscation.
		return rtrim( strtr( base64_encode( $raw ), '+/', '-_' ), '=' );
	}
}
