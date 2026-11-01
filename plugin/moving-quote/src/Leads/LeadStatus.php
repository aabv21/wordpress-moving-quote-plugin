<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

enum LeadStatus: string {
	case New       = 'new';
	case Contacted = 'contacted';
	case Quoted    = 'quoted';
	case Won       = 'won';
	case Lost      = 'lost';
}
