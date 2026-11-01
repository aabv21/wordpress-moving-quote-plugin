<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

final readonly class Estimate {
	public function __construct(
		public int $amount,
		public int $low,
		public int $high,
		public int $distance_km
	) {
	}
}
