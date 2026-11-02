<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Security;

/**
 * The `estimate` and `submit` rate-limit bucket settings, filterable through
 * `moving_quote_rate_limits` so a site that needs a different budget (a busier launch, a stricter
 * anti-abuse posture) can change it without editing the plugin. Keeps today's values as the
 * defaults when the filter isn't used.
 */
final class RateLimits {
	private const DEFAULT_ESTIMATE_LIMIT    = 120;
	private const DEFAULT_ESTIMATE_WINDOW_S = 600;
	private const DEFAULT_SUBMIT_LIMIT      = 5;
	private const DEFAULT_SUBMIT_WINDOW_S   = 3600;

	/** @return array{limit: int, window_seconds: int} */
	public static function estimate(): array {
		return self::bucket( 'estimate', self::DEFAULT_ESTIMATE_LIMIT, self::DEFAULT_ESTIMATE_WINDOW_S );
	}

	/** @return array{limit: int, window_seconds: int} */
	public static function submit(): array {
		return self::bucket( 'submit', self::DEFAULT_SUBMIT_LIMIT, self::DEFAULT_SUBMIT_WINDOW_S );
	}

	/** @return array{limit: int, window_seconds: int} */
	private static function bucket( string $name, int $default_limit, int $default_window_seconds ): array {
		/** @var mixed $all a filter callback can return anything, regardless of what was passed in */
		$all = apply_filters(
			'moving_quote_rate_limits',
			[
				'estimate' => [
					'limit'          => self::DEFAULT_ESTIMATE_LIMIT,
					'window_seconds' => self::DEFAULT_ESTIMATE_WINDOW_S,
				],
				'submit'   => [
					'limit'          => self::DEFAULT_SUBMIT_LIMIT,
					'window_seconds' => self::DEFAULT_SUBMIT_WINDOW_S,
				],
			]
		);

		$fallback = [
			'limit'          => $default_limit,
			'window_seconds' => $default_window_seconds,
		];

		if ( ! is_array( $all ) || ! isset( $all[ $name ] ) ) {
			return $fallback;
		}

		$bucket = $all[ $name ];
		if ( ! is_array( $bucket ) || ! isset( $bucket['limit'], $bucket['window_seconds'] ) || ! is_int( $bucket['limit'] ) || ! is_int( $bucket['window_seconds'] ) || $bucket['limit'] < 1 || $bucket['window_seconds'] < 1 ) {
			return $fallback;
		}

		return [
			'limit'          => $bucket['limit'],
			'window_seconds' => $bucket['window_seconds'],
		];
	}
}
