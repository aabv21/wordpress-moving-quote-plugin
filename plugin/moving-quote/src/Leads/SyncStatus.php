<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Leads;

enum SyncStatus: string {
	case Pending = 'pending';
	case Sent    = 'sent';
	case Failed  = 'failed';
}
