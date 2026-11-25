<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Frontend;

use Chivabox\MovingQuote\Leads\{Labels, LeadRecord, LeadRepository, LeadStatus};
use Chivabox\MovingQuote\Plugin;
use Chivabox\MovingQuote\Pricing\Estimate;
use Chivabox\MovingQuote\Rest\Messages;

/**
 * `[moving_quote_status]`: the customer's own page, opened from the link in their email. The link
 * carries the lead's UUID and an HMAC of it (`StatusToken`), never a name, phone or email, and the
 * page shows the move summary and a "confirm my date" button, never contact data.
 *
 * Every failure (a missing or malformed value, a token for another lead, a deleted lead) prints
 * the same sentence, so the page can't be used to probe which leads exist.
 */
final class StatusShortcode {
	public const TAG       = 'moving_quote_status';
	public const ACTION    = 'moving_quote_confirm_date';
	public const PAGE_SLUG = 'my-move';

	/** The page's slug in each language `setup.sh` creates it in. */
	private const PAGE_SLUGS = [ 'my-move', 'mi-mudanza' ];

	public static function register(): void {
		add_shortcode( self::TAG, [ self::class, 'render' ] );
		add_action( 'admin_post_nopriv_moving_quote_confirm_date', [ self::class, 'handle_confirm' ] );
		add_action( 'admin_post_moving_quote_confirm_date', [ self::class, 'handle_confirm' ] );
		add_action( 'template_redirect', [ self::class, 'send_private_headers' ] );
		add_filter( 'wp_robots', [ self::class, 'robots' ] );
		add_filter( 'wp_sitemaps_posts_query_args', [ self::class, 'leave_out_of_sitemap' ], 10, 2 );
	}

	/** True on the status page in any language, with or without a link. */
	private static function is_status_page(): bool {
		$page = get_queried_object();
		return is_page() && $page instanceof \WP_Post && in_array( $page->post_name, self::PAGE_SLUGS, true );
	}

	/**
	 * The page is for one customer at a time and never worth a search result, so `noindex` always.
	 *
	 * @param array<string, bool|string> $robots
	 * @return array<string, bool|string>
	 */
	public static function robots( array $robots ): array {
		if ( self::is_status_page() ) {
			$robots['noindex']  = true;
			$robots['nofollow'] = true;
		}
		return $robots;
	}

	/**
	 * @param array<string, mixed> $args
	 * @return array<string, mixed>
	 */
	public static function leave_out_of_sitemap( array $args, string $post_type ): array {
		if ( 'page' !== $post_type ) {
			return $args;
		}

		$ids = [];
		foreach ( self::PAGE_SLUGS as $slug ) {
			$page = get_page_by_path( $slug );
			if ( null !== $page ) {
				$ids[] = $page->ID;
			}
		}
		$existing             = $args['post__not_in'] ?? [];
		$args['post__not_in'] = array_merge( is_array( $existing ) ? $existing : [], $ids );

		return $args;
	}

	/**
	 * The signing key, derived from WordPress's own `auth` salt, so no new secret is stored. Rotating
	 * that salt invalidates every link already emailed.
	 */
	public static function key(): string {
		return hash_hmac( 'sha256', 'moving-quote-status-v1', wp_salt( 'auth' ) );
	}

	/**
	 * The signed link for a lead, on the status page in the lead's language, or `''` when that page
	 * doesn't exist.
	 */
	public static function url_for( LeadRecord $lead ): string {
		$page = Shortcode::page_url( self::PAGE_SLUG, self::language_of( $lead ) );
		if ( null === $page ) {
			return '';
		}

		return add_query_arg(
			[
				'lead'  => $lead->request_uuid,
				'token' => StatusToken::sign( $lead->request_uuid, self::key() ),
			],
			$page
		);
	}

	/**
	 * The page is never indexed. A link with its token in the query must also not be cached, or
	 * leaked in a Referer header to a third party the page links to.
	 */
	public static function send_private_headers(): void {
		if ( ! self::is_status_page() ) {
			return;
		}

		header( 'X-Robots-Tag: noindex, nofollow' );
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- only the presence of the two query args is read, to pick the headers.
		if ( isset( $_GET['lead'], $_GET['token'] ) ) {
			nocache_headers();
			header( 'Referrer-Policy: no-referrer' );
		}
	}

	/**
	 * `es_CO` is Polylang's `es`; a row saved before the locale column has no language, so the
	 * site's own is used.
	 */
	private static function language_of( LeadRecord $lead ): ?string {
		return '' === $lead->locale ? null : strtolower( explode( '_', $lead->locale )[0] );
	}

	/** A language code from a form, kept only when Polylang lists it; anything else is the site's own. */
	private static function supported_language( string $code ): ?string {
		if ( ! function_exists( 'pll_languages_list' ) || ! in_array( $code, pll_languages_list(), true ) ) {
			return null;
		}
		return $code;
	}

	/** The verified lead for a `lead` and `token` pair, or null for any reason at all. */
	private static function verified_lead( string $uuid, string $token ): ?LeadRecord {
		if ( ! StatusToken::is_uuid( $uuid ) || ! StatusToken::verify( $uuid, $token, self::key() ) ) {
			return null;
		}

		return ( new LeadRepository() )->find_by_uuid( $uuid );
	}

	/**
	 * @param array<string, mixed> $source
	 */
	private static function string_arg( array $source, string $key ): string {
		$value = $source[ $key ] ?? null;
		return is_string( $value ) ? wp_unslash( $value ) : '';
	}

	public static function render(): string {
		wp_enqueue_style( Shortcode::HANDLE );

		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- a read-only page: the signed token in the link is its authorization, and nothing changes here.
		$lead = self::verified_lead( self::string_arg( $_GET, 'lead' ), self::string_arg( $_GET, 'token' ) );
		// phpcs:enable WordPress.Security.NonceVerification.Recommended

		ob_start();
		if ( null === $lead ) {
			printf( '<p class="moving-quote-status__invalid">%s</p>', esc_html__( 'This link isn\'t valid. Check the link in your email, or contact us.', 'moving-quote' ) );
		} else {
			self::print_summary( $lead );
		}
		$html = ob_get_clean();

		return false !== $html ? $html : '';
	}

	private static function print_summary( LeadRecord $lead ): void {
		$tz        = new \DateTimeZone( Plugin::TIMEZONE );
		$move_day  = new \DateTimeImmutable( $lead->move_date, $tz );
		$today     = ( new \DateTimeImmutable( 'now', $tz ) )->format( 'Y-m-d' );
		$estimate  = new Estimate( $lead->estimate_cop, $lead->estimate_low_cop, $lead->estimate_high_cop, $lead->distance_km );
		$can_offer = null === $lead->date_confirmed_at && LeadStatus::Lost !== $lead->status && $lead->move_date >= $today;
		?>
		<div class="moving-quote-status" data-status>
			<p class="moving-quote-status__state"><?php echo esc_html( self::status_line( $lead->status ) ); ?></p>
			<dl class="moving-quote-status__summary">
				<div><dt><?php esc_html_e( 'Reference', 'moving-quote' ); ?></dt><dd><?php echo esc_html( $lead->reference() ); ?></dd></div>
				<div><dt><?php esc_html_e( 'Route', 'moving-quote' ); ?></dt><dd><?php echo esc_html( $lead->origin_city . " \u{2192} " . $lead->destination_city ); ?></dd></div>
				<div><dt><?php esc_html_e( 'Move date', 'moving-quote' ); ?></dt><dd><?php echo esc_html( self::format( $move_day->getTimestamp(), false ) ); ?></dd></div>
				<div><dt><?php esc_html_e( 'Move type', 'moving-quote' ); ?></dt><dd><?php echo esc_html( Labels::move_type( $lead->move_type ) ); ?></dd></div>
				<div><dt><?php esc_html_e( 'Estimate', 'moving-quote' ); ?></dt><dd><?php echo esc_html( Messages::display( $estimate ) ); ?></dd></div>
			</dl>
			<?php if ( null !== $lead->date_confirmed_at ) : ?>
				<p class="moving-quote-status__confirmed">
					<?php
					echo esc_html(
						sprintf(
							/* translators: %s: the date and time the customer confirmed, in the business time zone */
							__( 'You confirmed your moving date on %s.', 'moving-quote' ),
							self::format( ( new \DateTimeImmutable( $lead->date_confirmed_at, new \DateTimeZone( 'UTC' ) ) )->getTimestamp(), true )
						)
					);
					?>
				</p>
			<?php elseif ( $can_offer ) : ?>
				<?php // No nonce: the visitor has no session, and the signed token is the authorization. ?>
				<form class="moving-quote-status__confirm" method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
					<input type="hidden" name="action" value="<?php echo esc_attr( self::ACTION ); ?>" />
					<input type="hidden" name="lead" value="<?php echo esc_attr( $lead->request_uuid ); ?>" />
					<input type="hidden" name="token" value="<?php echo esc_attr( StatusToken::sign( $lead->request_uuid, self::key() ) ); ?>" />
					<input type="hidden" name="lang" value="<?php echo esc_attr( self::language_of( $lead ) ?? '' ); ?>" />
					<button type="submit" class="moving-quote-status__button"><?php esc_html_e( 'Confirm my moving date', 'moving-quote' ); ?></button>
				</form>
			<?php endif; ?>
		</div>
		<?php
	}

	/** The date (and time) in the page's language, in the business time zone. */
	private static function format( int $timestamp, bool $with_time ): string {
		$locale  = determine_locale();
		$pattern = $with_time ? StatusDate::confirmed_format( $locale ) : StatusDate::move_date_format( $locale );

		$formatted = wp_date( $pattern, $timestamp, new \DateTimeZone( Plugin::TIMEZONE ) );
		return false === $formatted ? '' : $formatted;
	}

	private static function status_line( LeadStatus $status ): string {
		return match ( $status ) {
			LeadStatus::New, LeadStatus::Contacted => __( 'We received your request', 'moving-quote' ),
			LeadStatus::Quoted                     => __( 'We sent you a quote', 'moving-quote' ),
			LeadStatus::Won                        => __( 'Your move is booked', 'moving-quote' ),
			LeadStatus::Lost                       => __( 'This request is closed', 'moving-quote' ),
		};
	}

	/**
	 * Confirms the date for a verified link and returns to the status page. An invalid token changes
	 * nothing and lands on the same page, which prints the same invalid-link sentence.
	 */
	public static function handle_confirm(): void {
		// phpcs:disable WordPress.Security.NonceVerification.Missing -- no session to hold a nonce: the signed token in the request is the authorization.
		$uuid  = self::string_arg( $_POST, 'lead' );
		$token = self::string_arg( $_POST, 'token' );
		// phpcs:enable WordPress.Security.NonceVerification.Missing

		$lead = self::verified_lead( $uuid, $token );
		if ( null !== $lead ) {
			// The page hides the button for a past move date; a forged POST must not get past that.
			$today = ( new \DateTimeImmutable( 'now', new \DateTimeZone( Plugin::TIMEZONE ) ) )->format( 'Y-m-d' );
			if ( $lead->move_date >= $today ) {
				( new LeadRepository() )->confirm_date( $lead->request_uuid, gmdate( 'Y-m-d H:i:s' ) );
			}
			$target = add_query_arg( 'confirmed', '1', self::url_for( $lead ) );
		} else {
			// The visitor's language rides in the form (the page sends no Referer); it only picks among
			// the site's own languages, so a lead's existence never shows in where this lands.
			$lang   = self::string_arg( $_POST, 'lang' ); // phpcs:ignore WordPress.Security.NonceVerification.Missing -- no session to hold a nonce: the signed token is the authorization.
			$page   = Shortcode::page_url( self::PAGE_SLUG, self::supported_language( $lang ) ) ?? home_url( '/' );
			$target = add_query_arg( array_filter( [ 'lead' => StatusToken::is_uuid( $uuid ) ? $uuid : '' ] ), $page );
		}

		wp_safe_redirect( $target );
		exit;
	}
}
