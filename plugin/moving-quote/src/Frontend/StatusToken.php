<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

/**
 * The signature in a customer's status link: an HMAC-SHA256 over the lead's UUID, hex encoded.
 * The link carries the UUID and this token, never a name, phone or email. Pure: the caller passes
 * the key (`StatusShortcode::key()`).
 *
 * NOTE: the token never expires, so anyone holding the emailed link sees the move summary (the
 * route, date, estimate and status, never the name, phone or email) until the lead is deleted.
 * Upgrade path: sign an expiry inside the message (`uuid|expires_at`), carry the expiry in the
 * link, and have `verify()` reject a past one.
 */
final class StatusToken {
	private const MESSAGE_PREFIX = 'moving-quote-status|';
	private const UUID_PATTERN   = '/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/D';
	private const TOKEN_PATTERN  = '/^[0-9a-f]{64}$/D';

	public static function sign( string $request_uuid, string $key ): string {
		return hash_hmac( 'sha256', self::MESSAGE_PREFIX . $request_uuid, $key );
	}

	/** Constant time, and only for a token in the exact shape `sign()` returns. */
	public static function verify( string $request_uuid, string $token, string $key ): bool {
		if ( 1 !== preg_match( self::TOKEN_PATTERN, $token ) ) {
			return false;
		}

		return hash_equals( self::sign( $request_uuid, $key ), $token );
	}

	/** A lowercase UUID v4, the only shape the plugin stores; anything else is never looked up. */
	public static function is_uuid( string $value ): bool {
		return 1 === preg_match( self::UUID_PATTERN, $value );
	}
}
