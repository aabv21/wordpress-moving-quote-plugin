<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

use Chivabox\MovingQuote\Leads\LeadRecord;
use DateTimeImmutable;
use DateTimeZone;

final class LeadPayload {
	public const TTL_SECONDS = 300;

	/** Encoded once and reused for both the request and its signature. */
	public static function body( LeadRecord $lead, string $site_name, string $team_email, DateTimeZone $tz ): string {
		$created_at   = new DateTimeImmutable( $lead->created_at, new DateTimeZone( 'UTC' ) );
		$submitted_at = $created_at->setTimezone( $tz )->format( DATE_ATOM );

		$payload = [
			'request_uuid' => $lead->request_uuid,
			'reference'    => $lead->reference(),
			'submitted_at' => $submitted_at,
			'site_name'    => $site_name,
			'team_email'   => $team_email,
			'locale'       => $lead->locale,
			'customer'     => [
				'name'  => $lead->customer_name,
				'phone' => $lead->phone,
				'email' => $lead->email,
			],
			'move'         => [
				'type'        => $lead->move_type,
				'rooms'       => $lead->rooms,
				'origin'      => $lead->origin_city,
				'destination' => $lead->destination_city,
				'distance_km' => $lead->distance_km,
				'date'        => $lead->move_date,
				'extras'      => $lead->extras,
			],
			'estimate'     => [
				'currency' => 'COP',
				'amount'   => $lead->estimate_cop,
				'low'      => $lead->estimate_low_cop,
				'high'     => $lead->estimate_high_cop,
			],
		];

		// phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- pure class; wp_json_encode() is unavailable without WordPress.
		return json_encode( $payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR );
	}

	/** @return array{jti: string, iat: int, exp: int, body_sha256: string} */
	public static function claims( string $request_uuid, string $body, int $now ): array {
		return [
			'jti'         => $request_uuid,
			'iat'         => $now,
			'exp'         => $now + self::TTL_SECONDS,
			'body_sha256' => hash( 'sha256', $body ),
		];
	}
}
