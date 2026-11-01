<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

enum MoveType: string {
	case Apartment = 'apartment';
	case House     = 'house';
	case Office    = 'office';
}
