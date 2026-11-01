<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

use Chivabox\MovingQuote\Pricing\QuoteInput;

/** A validated, normalized lead submission, ready to be priced and saved. */
final readonly class LeadDraft {
	public function __construct(
		public string $submission_id,
		public QuoteInput $quote,
		public string $move_date,
		public string $name,
		public string $phone,
		public string $email
	) {
	}
}
