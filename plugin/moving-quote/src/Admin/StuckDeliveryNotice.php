<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\LeadRepository;
use Chivabox\MovingQuote\Security\RateLimiter;

/**
 * Shown only on the Dashboard and the Leads page, to `manage_options` users: the one audience who
 * can act on it.
 */
final class StuckDeliveryNotice {
	private const STUCK_AFTER_SECONDS = HOUR_IN_SECONDS;

	public static function register(): void {
		add_action( 'admin_notices', [ self::class, 'maybe_render' ] );
	}

	public static function maybe_render(): void {
		if ( ! current_user_can( 'manage_options' ) || ! self::on_relevant_screen() ) {
			return;
		}

		$count = ( new LeadRepository() )->count_stuck( time() - self::STUCK_AFTER_SECONDS );
		if ( 0 !== $count ) {
			printf(
				'<div class="notice notice-warning"><p>%s</p></div>',
				wp_kses_post(
					sprintf(
						/* translators: 1: number of stuck leads, 2: link to the Leads page */
						_n( '%1$d lead has not reached n8n yet. %2$s', '%1$d leads have not reached n8n yet. %2$s', $count, 'moving-quote' ),
						$count,
						sprintf(
							'<a href="%s">%s</a>',
							esc_url( admin_url( 'admin.php?page=' . Menu::SLUG ) ),
							esc_html__( 'View leads', 'moving-quote' )
						)
					)
				)
			);
		}

		self::maybe_render_rate_limited_notice();
	}

	private static function maybe_render_rate_limited_notice(): void {
		$count = RateLimiter::rate_limited_submission_count();
		if ( 0 === $count ) {
			return;
		}

		printf(
			'<div class="notice notice-warning"><p>%s</p></div>',
			esc_html(
				sprintf(
					/* translators: %d: number of rate-limited quote submissions in the current 24-hour window */
					_n( '%d quote submission was rate-limited in the current 24-hour window.', '%d quote submissions were rate-limited in the current 24-hour window.', $count, 'moving-quote' ),
					$count
				)
			)
		);
	}

	private static function on_relevant_screen(): bool {
		$screen = get_current_screen();
		if ( null === $screen ) {
			return false;
		}

		return in_array( $screen->id, [ 'dashboard', 'toplevel_page_' . Menu::SLUG ], true );
	}
}
