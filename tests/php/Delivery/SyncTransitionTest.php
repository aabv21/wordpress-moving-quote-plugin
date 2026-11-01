<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Tests\Delivery;

use Chivabox\MovingQuote\Delivery\SyncTransition;
use Chivabox\MovingQuote\Leads\SyncStatus;
use PHPUnit\Framework\TestCase;

final class SyncTransitionTest extends TestCase {
	private const NOW = 1000;

	public function test_a_first_success_is_sent_with_one_attempt(): void {
		$update = SyncTransition::after_attempt( 0, true, '', self::NOW );
		self::assertSame( SyncStatus::Sent, $update->status );
		self::assertSame( 1, $update->attempts );
		self::assertSame( 0, $update->next_attempt_at );
		self::assertSame( '', $update->last_error );
		self::assertSame( self::NOW, $update->sent_at );
	}

	public function test_a_first_failure_stays_pending_with_the_base_delay(): void {
		$update = SyncTransition::after_attempt( 0, false, 'cURL error 6: Could not resolve host: n8n', self::NOW );
		self::assertSame( SyncStatus::Pending, $update->status );
		self::assertSame( 1, $update->attempts );
		self::assertSame( self::NOW + 60, $update->next_attempt_at );
		self::assertSame( 'cURL error 6: Could not resolve host: n8n', $update->last_error );
	}

	public function test_a_fifth_failure_backs_off_further(): void {
		$update = SyncTransition::after_attempt( 4, false, 'HTTP 503: x', self::NOW );
		self::assertSame( SyncStatus::Pending, $update->status );
		self::assertSame( 5, $update->attempts );
		self::assertSame( self::NOW + 960, $update->next_attempt_at );
	}

	public function test_the_tenth_failure_reaches_failed_with_no_next_attempt_or_sent_at(): void {
		$update = SyncTransition::after_attempt( 9, false, 'x', self::NOW );
		self::assertSame( SyncStatus::Failed, $update->status );
		self::assertSame( 10, $update->attempts );
		self::assertSame( 0, $update->next_attempt_at );
		self::assertNull( $update->sent_at );
	}

	public function test_a_later_success_clears_the_error(): void {
		$update = SyncTransition::after_attempt( 3, true, '', self::NOW );
		self::assertSame( SyncStatus::Sent, $update->status );
		self::assertSame( 4, $update->attempts );
		self::assertSame( '', $update->last_error );
	}

	public function test_a_long_error_is_cut_to_500_characters_by_mb_strlen(): void {
		$update = SyncTransition::after_attempt( 0, false, str_repeat( 'é', 600 ), self::NOW );
		self::assertSame( 500, mb_strlen( $update->last_error ) );
	}
}
