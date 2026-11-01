<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Settings;

/**
 * @phpstan-import-type SettingsShape from Defaults
 */
final readonly class SanitizedSettings {
	/**
	 * @param SettingsShape         $settings
	 * @param array<string, string> $errors   field or route key (e.g. `routes.3`) to error code
	 */
	public function __construct(
		public array $settings,
		public array $errors
	) {
	}
}
