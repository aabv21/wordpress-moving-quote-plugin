<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Pricing\MoveType;

/**
 * Reads the quote form's prefill from a link's query (the hero's step 1, a route chip). Pure. A
 * value counts only when it's exactly a move type or one of the cities, so a shared or stale link
 * can't put anything else in the form or echo it back.
 */
final class Prefill {
	/** Prefixed, so they never collide with WordPress's own query vars (`type`, `from`). */
	public const TYPE_ARG = 'mq_type';
	public const FROM_ARG = 'mq_from';
	public const TO_ARG   = 'mq_to';

	/**
	 * @param array<array-key, mixed> $query  the request's query args, unslashed
	 * @param list<string>            $cities the cities the form offers
	 * @return array{move_type: ?string, origin: ?string, destination: ?string}
	 */
	public static function from_query( array $query, array $cities ): array {
		$type = $query[ self::TYPE_ARG ] ?? null;
		return [
			'move_type'   => is_string( $type ) && null !== MoveType::tryFrom( $type ) ? $type : null,
			'origin'      => self::city( $query[ self::FROM_ARG ] ?? null, $cities ),
			'destination' => self::city( $query[ self::TO_ARG ] ?? null, $cities ),
		];
	}

	/** @param list<string> $cities */
	private static function city( mixed $value, array $cities ): ?string {
		return is_string( $value ) && in_array( $value, $cities, true ) ? $value : null;
	}

	/**
	 * A GET form replaces its action's query string with its own fields, so the page a plain
	 * permalink (`?page_id=12`) or Polylang's `?lang=es` names would be lost. This splits the URL
	 * into the action and the fields to carry as hidden inputs.
	 *
	 * @return array{action: string, fields: array<string, string>}
	 */
	public static function form_target( string $url ): array {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- pure class; wp_parse_url() is unavailable without WordPress.
		$query = parse_url( $url, PHP_URL_QUERY );
		if ( ! is_string( $query ) || '' === $query ) {
			return [
				'action' => $url,
				'fields' => [],
			];
		}

		parse_str( $query, $parsed );
		$fields = [];
		foreach ( $parsed as $key => $value ) {
			if ( is_string( $value ) ) {
				$fields[ (string) $key ] = $value;
			}
		}

		return [
			'action' => substr( $url, 0, (int) strpos( $url, '?' ) ),
			'fields' => $fields,
		];
	}
}
