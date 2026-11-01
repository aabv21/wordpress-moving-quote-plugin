<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Settings;

/**
 * @phpstan-type RouteSetting array{from: string, to: string, km: int}
 * @phpstan-type SettingsShape array{
 *     base_rates: array{apartment: int, house: int, office: int},
 *     per_room: int,
 *     per_km: int,
 *     extras: array{packing: int, furniture_assembly: int, storage: int, piano_fragile: int},
 *     range_percent: int,
 *     routes: list<RouteSetting>,
 *     webhook_url: string,
 *     webhook_secret: string,
 *     team_email: string,
 * }
 */
final class Defaults {
	/** @return SettingsShape */
	public static function settings(): array {
		return [
			'base_rates'     => [
				'apartment' => 350000,
				'house'     => 500000,
				'office'    => 800000,
			],
			'per_room'       => 150000,
			'per_km'         => 4000,
			'extras'         => [
				'packing'            => 200000,
				'furniture_assembly' => 150000,
				'storage'            => 300000,
				'piano_fragile'      => 250000,
			],
			'range_percent'  => 10,
			'routes'         => self::routes(),
			'webhook_url'    => '',
			'webhook_secret' => '',
			'team_email'     => '',
		];
	}

	/** @return list<RouteSetting> */
	private static function routes(): array {
		return [
			[
				'from' => 'Barranquilla',
				'to'   => 'Cartagena',
				'km'   => 120,
			],
			[
				'from' => 'Barranquilla',
				'to'   => 'Santa Marta',
				'km'   => 100,
			],
			[
				'from' => 'Barranquilla',
				'to'   => 'Valledupar',
				'km'   => 300,
			],
			[
				'from' => 'Barranquilla',
				'to'   => 'Montería',
				'km'   => 350,
			],
			[
				'from' => 'Barranquilla',
				'to'   => 'Sincelejo',
				'km'   => 290,
			],
			[
				'from' => 'Barranquilla',
				'to'   => 'Riohacha',
				'km'   => 270,
			],
			[
				'from' => 'Cartagena',
				'to'   => 'Santa Marta',
				'km'   => 220,
			],
			[
				'from' => 'Cartagena',
				'to'   => 'Valledupar',
				'km'   => 400,
			],
			[
				'from' => 'Cartagena',
				'to'   => 'Montería',
				'km'   => 250,
			],
			[
				'from' => 'Cartagena',
				'to'   => 'Sincelejo',
				'km'   => 185,
			],
			[
				'from' => 'Cartagena',
				'to'   => 'Riohacha',
				'km'   => 390,
			],
			[
				'from' => 'Santa Marta',
				'to'   => 'Valledupar',
				'km'   => 240,
			],
			[
				'from' => 'Santa Marta',
				'to'   => 'Montería',
				'km'   => 450,
			],
			[
				'from' => 'Santa Marta',
				'to'   => 'Sincelejo',
				'km'   => 390,
			],
			[
				'from' => 'Santa Marta',
				'to'   => 'Riohacha',
				'km'   => 170,
			],
			[
				'from' => 'Valledupar',
				'to'   => 'Montería',
				'km'   => 470,
			],
			[
				'from' => 'Valledupar',
				'to'   => 'Sincelejo',
				'km'   => 370,
			],
			[
				'from' => 'Valledupar',
				'to'   => 'Riohacha',
				'km'   => 170,
			],
			[
				'from' => 'Montería',
				'to'   => 'Sincelejo',
				'km'   => 100,
			],
			[
				'from' => 'Montería',
				'to'   => 'Riohacha',
				'km'   => 620,
			],
			[
				'from' => 'Sincelejo',
				'to'   => 'Riohacha',
				'km'   => 560,
			],
		];
	}
}
