<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

final readonly class QuoteInput {
	/** @param list<Extra> $extras */
	public function __construct(
		public MoveType $type,
		public int $rooms,
		public string $origin,
		public string $destination,
		public array $extras
	) {
	}
}
