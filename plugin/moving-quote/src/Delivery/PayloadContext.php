<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Delivery;

/**
 * The site-wide values each lead payload carries next to the lead itself: the site name, the
 * team's address, and the business numbers the customer email shows (digits, or `''` when unset).
 */
final readonly class PayloadContext {
	public function __construct(
		public string $site_name,
		public string $team_email,
		public string $contact_phone,
		public string $contact_whatsapp
	) {
	}
}
