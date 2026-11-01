<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

/** Every validation failure for one submission, as field name to error code. */
final readonly class FieldErrors {
	/** @param array<string, string> $errors */
	public function __construct(
		public array $errors
	) {
	}
}
