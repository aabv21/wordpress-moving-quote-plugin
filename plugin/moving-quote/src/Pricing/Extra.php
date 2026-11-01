<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Pricing;

enum Extra: string {
	case Packing           = 'packing';
	case FurnitureAssembly = 'furniture_assembly';
	case Storage           = 'storage';
	case PianoFragile      = 'piano_fragile';
}
