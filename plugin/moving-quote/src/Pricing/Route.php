<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

final readonly class Route {
	public function __construct(
		public string $from,
		public string $to,
		public int $km
	) {
	}
}
