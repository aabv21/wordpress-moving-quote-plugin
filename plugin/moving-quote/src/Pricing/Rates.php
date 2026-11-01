<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

use Chivabox\MovingQuote\Settings\Defaults;

/**
 * @phpstan-import-type SettingsShape from Defaults
 */
final readonly class Rates {
	/**
	 * @param array{apartment: int, house: int, office: int}                             $base
	 * @param array{packing: int, furniture_assembly: int, storage: int, piano_fragile: int} $extras
	 */
	public function __construct(
		public array $base,
		public int $per_room,
		public int $per_km,
		public array $extras,
		public int $range_percent
	) {
	}

	/** @param SettingsShape $settings */
	public static function from_settings( array $settings ): self {
		return new self(
			[
				'apartment' => (int) $settings['base_rates']['apartment'],
				'house'     => (int) $settings['base_rates']['house'],
				'office'    => (int) $settings['base_rates']['office'],
			],
			(int) $settings['per_room'],
			(int) $settings['per_km'],
			[
				'packing'            => (int) $settings['extras']['packing'],
				'furniture_assembly' => (int) $settings['extras']['furniture_assembly'],
				'storage'            => (int) $settings['extras']['storage'],
				'piano_fragile'      => (int) $settings['extras']['piano_fragile'],
			],
			(int) $settings['range_percent']
		);
	}
}
