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
 * The public lead endpoint: validates, dedupes by the browser-minted submission ID, saves the
 * lead, and answers per the REST contract.
 *
 * The `submit` rate limit is counted only once a lead is about to be inserted — after the
 * honeypot, validation, and the duplicate lookup all pass — so a customer correcting a typo, or
 * double-tapping Submit, never burns through the limit on an attempt that was never going to save
 * anything.
 */
final class LeadController {
	private const NAMESPACE = 'moving-quote/v1';
	private const ROUTE     = '/leads';

	public static function register(): void {
		// No args schema: every field is validated by LeadValidator, so a restrictive schema here
		// would make core reject a bad request with its own 400 before the contract's 422 ever runs.
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
	 * Core's own `rest_cookie_check_errors` already rejects a stale or forged `X-WP-Nonce` with
	 * 403 `rest_cookie_invalid_nonce` before this ever runs. This callback only has to cover the
	 * one case core lets through: no nonce header at all.
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
			// A filled honeypot field means a bot filled every field blindly. Answer as if the
			// submission succeeded, but save nothing and spend nothing: a real customer never sees
			// this field, so nothing here should affect their own rate-limit budget or logs.
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
			$record = $repository->insert( $draft, $estimate, $now, $now + Outbox::LEASE_SECONDS );
		} catch ( Throwable $e ) {
			error_log( 'moving-quote: lead insert failed: ' . $e->getMessage() ); // phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log -- no dedicated logging service exists; the message carries no PII.
			return self::save_failed();
		}

		if ( null === $record ) {
			// LeadRepository::insert() returns null only once it has confirmed request_uuid now
			// exists: another request for the same UUID raced ahead of this one and already won, so
			// look up that row and answer with its data instead of a duplicate row or a lost lead.
			// That other request's own insert() call is the one that triggers delivery; this one must
			// not, or the same lead would be attempted twice for one winning insert.
			$winner = $repository->find_by_uuid( $draft->submission_id );
			if ( null !== $winner ) {
				return self::saved( $winner );
			}
			// Unreachable under LeadRepository's documented contract; kept as a safety net in case
			// that contract ever changes without this call site being updated to match.
			return self::save_failed();
		}

		self::attempt_delivery( $record );

		return self::saved( $record, 201 );
	}

	/**
	 * The inline delivery attempt for a lead that was just inserted. The response is 201 regardless
	 * of the outcome, so the customer never sees an error the outbox's own retries will resolve on
	 * their own; this can still delay that 201 by up to `WebhookClient`'s 5 s timeout.
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
		$messages = array_map( [ Messages::class, 'field' ], $errors->errors );
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
	 * The parsed JSON request body as a string-keyed array. The stub types get_json_params() as
	 * always returning array, but a top-level JSON scalar (e.g. a bare string or number) is valid
	 * JSON and decodes to that scalar at runtime, not an array; this guards against that case
	 * instead of trusting the stub over the real behavior.
	 *
	 * @return array<string, mixed>
	 */
	private static function json_object( WP_REST_Request $request ): array {
		$params = $request->get_json_params(); // @phpstan-ignore-next-line function.alreadyNarrowedType (see the note above: the stub is optimistic)
		return is_array( $params ) ? $params : [];
	}
}
