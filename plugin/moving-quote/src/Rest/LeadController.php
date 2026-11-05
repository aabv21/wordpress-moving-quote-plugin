<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Rest;

use Chivabox\MovingQuote\Delivery\Outbox;
use Chivabox\MovingQuote\Leads\{FieldErrors, LeadDraft, LeadRecord, LeadRepository, LeadValidator};
use Chivabox\MovingQuote\Pricing\{Calculator, Estimate};
use Chivabox\MovingQuote\Security\{RateLimiter, RateLimits};
use Chivabox\MovingQuote\Settings\Options;
use DateTimeImmutable;
use DateTimeZone;
use Throwable;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

/**
 * The `submit` rate limit counts only a lead about to be inserted (after the honeypot, validation,
 * and duplicate lookup), so a corrected typo or a double tap never spends the budget.
 */
final class LeadController {
	private const NAMESPACE = 'moving-quote/v1';
	private const ROUTE     = '/leads';

	public static function register(): void {
		// No args schema: core would answer its own 400 before the contract's 422.
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			[
				'methods'             => 'POST',
				'callback'            => [ self::class, 'handle' ],
				'permission_callback' => [ self::class, 'check_nonce' ],
			]
		);
	}

	/**
	 * Core rejects a stale or forged `X-WP-Nonce` first (403 `rest_cookie_invalid_nonce`); this
	 * covers the case core lets through, a missing header.
	 */
	public static function check_nonce( WP_REST_Request $request ): bool|WP_Error {
		if ( null === $request->get_header( 'X-WP-Nonce' ) ) {
			return new WP_Error(
				'moving_quote_bad_nonce',
				__( 'Your session expired. Reload the page and try again.', 'moving-quote' ),
				[ 'status' => 403 ]
			);
		}
		return true;
	}

	public static function handle( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$input = self::json_object( $request );

		if ( '' !== ( $input['website'] ?? '' ) ) {
			// A bot filled the honeypot: answer success, but save and count nothing.
			return new WP_REST_Response( [ 'ok' => true ], 201 );
		}

		$now   = time();
		$draft = LeadValidator::lead( $input, Options::distances(), ( new DateTimeImmutable() )->setTimestamp( $now ), new DateTimeZone( 'America/Bogota' ) );
		if ( $draft instanceof FieldErrors ) {
			return self::invalid( $draft );
		}

		$estimate   = Calculator::estimate( $draft->quote, Options::rates(), Options::distances() );
		$repository = new LeadRepository();

		$existing = $repository->find_by_uuid( $draft->submission_id );
		if ( null !== $existing ) {
			return self::saved( $existing );
		}

		$bucket      = RateLimits::submit();
		$limiter     = new RateLimiter();
		$retry_after = $limiter->hit( 'submit', $bucket['limit'], $bucket['window_seconds'] );
		if ( 0 !== $retry_after ) {
			RateLimiter::record_rate_limited_submission();
			return self::rate_limited( $retry_after );
		}

		return self::insert( $repository, $draft, $estimate, $now );
	}

	private static function insert( LeadRepository $repository, LeadDraft $draft, Estimate $estimate, int $now ): WP_REST_Response|WP_Error {
		try {
			// The request's render language, including a multilingual plugin's filter.
			$record = $repository->insert( $draft, $estimate, $now, $now + Outbox::LEASE_SECONDS, determine_locale() );
		} catch ( Throwable $e ) {
			error_log( 'moving-quote: lead insert failed: ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- no dedicated logging service exists; the message carries no PII.
			return self::save_failed();
		}

		if ( null === $record ) {
			// Another request for the same UUID won the insert race: answer with its row, and leave
			// delivery to that request so the lead isn't attempted twice.
			$winner = $repository->find_by_uuid( $draft->submission_id );
			if ( null !== $winner ) {
				return self::saved( $winner );
			}
			// Unreachable under insert()'s contract; a safety net if that contract changes.
			return self::save_failed();
		}

		self::attempt_delivery( $record );

		return self::saved( $record, 201 );
	}

	/**
	 * The response is 201 whatever the outcome, since the outbox retries a failure; this can still
	 * delay it by up to `WebhookClient`'s 5 s timeout.
	 */
	private static function attempt_delivery( LeadRecord $record ): void {
		if ( ! Options::delivery_enabled() ) {
			return;
		}

		try {
			Outbox::deliver( $record );
			// phpcs:ignore Generic.CodeAnalysis.EmptyStatement.DetectedCatch -- deliberately empty: a last-resort guard against a failure outside deliver()'s own catch (e.g. the apply_sync() write itself), which must never turn a saved lead into a 500 for the customer.
		} catch ( Throwable ) {
		}
	}

	private static function saved( LeadRecord $record, int $status = 200 ): WP_REST_Response {
		return new WP_REST_Response(
			[
				'ok'        => true,
				'reference' => $record->reference(),
				'estimate'  => [
					'amount'      => $record->estimate_cop,
					'low'         => $record->estimate_low_cop,
					'high'        => $record->estimate_high_cop,
					'distance_km' => $record->distance_km,
					'currency'    => 'COP',
					'display'     => Messages::display( new Estimate( $record->estimate_cop, $record->estimate_low_cop, $record->estimate_high_cop, $record->distance_km ) ),
				],
			],
			$status
		);
	}

	private static function invalid( FieldErrors $errors ): WP_Error {
		$messages = Messages::fields( $errors->errors );
		return new WP_Error(
			'moving_quote_invalid',
			__( 'Please fix the highlighted fields.', 'moving-quote' ),
			[
				'status' => 422,
				'errors' => $messages,
			]
		);
	}

	private static function rate_limited( int $retry_after ): WP_Error {
		header( 'Retry-After: ' . $retry_after );
		return new WP_Error(
			'moving_quote_rate_limited',
			__( 'Too many requests. Please try again later.', 'moving-quote' ),
			[ 'status' => 429 ]
		);
	}

	private static function save_failed(): WP_Error {
		return new WP_Error(
			'moving_quote_save_failed',
			__( 'Something went wrong. Please try again.', 'moving-quote' ),
			[ 'status' => 500 ]
		);
	}

	/**
	 * The stub types get_json_params() as array, but a top-level JSON scalar decodes to that scalar.
	 *
	 * @return array<string, mixed>
	 */
	private static function json_object( WP_REST_Request $request ): array {
		$params = $request->get_json_params(); // @phpstan-ignore-next-line function.alreadyNarrowedType (see the note above: the stub is optimistic)
		return is_array( $params ) ? $params : [];
	}
}
