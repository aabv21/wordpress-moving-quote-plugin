<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Settings\Business;

/**
 * The home page's `MovingCompany` JSON-LD. Pure. A blank business field leaves its property out,
 * never an empty value, which a search engine would read as wrong data.
 */
final class BusinessSchema {
	/** Monday to Saturday, the hours line the footer prints. */
	private const OPEN_DAYS = [ 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ];

	/**
	 * @param list<string> $cities every city with a route, as `areaServed`
	 * @return array<string, mixed>
	 */
	public static function graph( Business $business, string $name, string $url, string $description, array $cities, string $in_language ): array {
		$graph = [
			'@context'    => 'https://schema.org',
			'@type'       => 'MovingCompany',
			'name'        => $name,
			'url'         => $url,
			'description' => $description,
			'inLanguage'  => $in_language,
			'areaServed'  => array_map(
				static fn ( string $city ): array => [
					'@type' => 'City',
					'name'  => $city,
				],
				$cities
			),
		];

		if ( $business->has_phone() ) {
			$graph['telephone'] = '+' . $business->phone;
		}
		if ( $business->has_address() ) {
			$graph['address'] = [
				'@type'           => 'PostalAddress',
				'streetAddress'   => $business->street,
				'addressLocality' => $business->city,
				'addressCountry'  => 'CO',
			];
		}
		if ( $business->has_hours() ) {
			$graph['openingHoursSpecification'] = [
				[
					'@type'     => 'OpeningHoursSpecification',
					'dayOfWeek' => self::OPEN_DAYS,
					'opens'     => $business->hours_open,
					'closes'    => $business->hours_close,
				],
			];
		}

		return $graph;
	}

	/**
	 * The graph as a `<script type="application/ld+json">` element. `JSON_HEX_TAG` escapes `<` and
	 * `>`, so no settings value can close the element early.
	 *
	 * @param array<string, mixed> $graph
	 */
	public static function script( array $graph ): string {
		// phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- pure class; wp_json_encode() is unavailable without WordPress.
		$json = json_encode( $graph, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_THROW_ON_ERROR );
		return '<script type="application/ld+json">' . $json . "</script>\n";
	}
}
