<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\{LeadRepository, LeadStatus};

/**
 * Every handler checks `manage_options` before its nonce, so a user who can't reach the page gets
 * the same error from a handler as from the page.
 */
final class LeadsPage {
	private const EXPORT_CHUNK = 500;
	public const NOTICE_ARG    = 'moving_quote_notice';

	public static function register_hooks(): void {
		add_action( 'admin_post_moving_quote_update_status', [ self::class, 'handle_update_status' ] );
		add_action( 'admin_post_moving_quote_export_csv', [ self::class, 'handle_export' ] );
		add_action( 'admin_post_moving_quote_retry_delivery', [ self::class, 'handle_retry' ] );
		add_action( 'admin_post_moving_quote_delete_lead', [ self::class, 'handle_delete' ] );
	}

	public static function render(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'moving-quote' ), 403 );
		}

		require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';

		$table = new LeadsListTable();
		$table->prepare_items();

		$status     = LeadsListTable::current_status();
		$export_url = add_query_arg(
			array_filter(
				[
					'action' => 'moving_quote_export_csv',
					'status' => $status?->value,
				]
			),
			admin_url( 'admin-post.php' )
		);
		$export_url = wp_nonce_url( $export_url, 'moving_quote_export_csv' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Moving quotes', 'moving-quote' ); ?></h1>
			<?php self::render_notice(); ?>
			<a href="<?php echo esc_url( $export_url ); ?>" class="page-title-action"><?php esc_html_e( 'Export CSV', 'moving-quote' ); ?></a>
			<?php
			/*
			 * No wrapping <form method="get">: every row prints its own POST form, and HTML drops a
			 * nested form's start tag, so the first row's status controls would fold into the wrapper
			 * and never take effect. Cost: the "Current Page" box can't submit on Enter; every other
			 * pagination control is a plain link.
			 */
			?>
			<?php $table->views(); ?>
			<?php $table->display(); ?>
		</div>
		<?php
	}

	private static function render_notice(): void {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only, and the notice text itself carries no state change; the handler that redirected here already checked its own nonce.
		$notice = self::string_field( $_GET, self::NOTICE_ARG );
		$text   = match ( $notice ) {
			'status_updated' => __( 'Lead status updated.', 'moving-quote' ),
			'retry_queued'   => __( 'The lead was queued for delivery.', 'moving-quote' ),
			'lead_deleted'   => __( 'The lead was deleted.', 'moving-quote' ),
			default          => '',
		};
		if ( '' === $text ) {
			return;
		}
		printf( '<div class="notice notice-success is-dismissible"><p>%s</p></div>', esc_html( $text ) );
	}

	public static function handle_update_status(): void {
		$id = self::require_id();
		check_admin_referer( 'moving_quote_update_status_' . $id );

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- the nonce above already covers this whole request.
		$raw = self::string_field( $_POST, 'status' );
		try {
			$status = LeadStatus::from( $raw );
			( new LeadRepository() )->update_status( $id, $status );
			// phpcs:ignore Generic.CodeAnalysis.EmptyStatement.DetectedCatch -- deliberately empty: an unrecognized status value changes nothing, and the redirect below still confirms the request was received.
		} catch ( \ValueError ) {
		}

		self::redirect_to_list( 'status_updated' );
	}

	public static function handle_retry(): void {
		$id = self::require_id();
		check_admin_referer( 'moving_quote_retry_delivery_' . $id );

		( new LeadRepository() )->requeue( $id, time() );

		self::redirect_to_list( 'retry_queued' );
	}

	/** `manage_options` is checked inside `require_id()`, then this row's own nonce. */
	public static function handle_delete(): void {
		$id = self::require_id();
		check_admin_referer( 'moving_quote_delete_lead_' . $id );

		( new LeadRepository() )->delete( $id );

		self::redirect_to_list( 'lead_deleted' );
	}

	/** Streams every matching lead as CSV: a UTF-8 BOM, the header, then batches of `EXPORT_CHUNK`. */
	public static function handle_export(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'moving-quote' ), 403 );
		}
		check_admin_referer( 'moving_quote_export_csv' );

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- the nonce above already covers this whole request.
		$raw    = self::string_field( $_GET, 'status' );
		$status = self::parse_status( $raw );
		$tz     = new \DateTimeZone( 'America/Bogota' );

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename="moving-leads-' . ( new \DateTimeImmutable( 'now', $tz ) )->format( 'Y-m-d' ) . '.csv"' );

		$out = fopen( 'php://output', 'w' );
		if ( false === $out ) {
			exit;
		}

		fwrite( $out, "\u{FEFF}" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fwrite -- streaming to php://output, not a filesystem path; WP_Filesystem has no equivalent.
		fputcsv( $out, LeadCsv::HEADER, ',', '"', '' );

		$repository = new LeadRepository();
		$after_id   = 0;
		$raw_count  = self::EXPORT_CHUNK;
		while ( self::EXPORT_CHUNK === $raw_count ) {
			$chunk     = $repository->chunk_after( $status, $after_id, self::EXPORT_CHUNK );
			$raw_count = $chunk['raw_count'];
			foreach ( $chunk['records'] as $lead ) {
				fputcsv( $out, LeadCsv::row( $lead, $tz ), ',', '"', '' );
			}
			// Loop on raw_count and advance to last_raw_id; see LeadRepository::chunk_after().
			$after_id = $chunk['last_raw_id'];
		}

		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- streaming to php://output, not a filesystem path; WP_Filesystem has no equivalent.
		exit;
	}

	/** Dies with 403 for a disallowed user, or 400 for a missing or non-numeric id. */
	private static function require_id(): int {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'moving-quote' ), 403 );
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing, WordPress.Security.NonceVerification.Recommended -- the id is read before the nonce check only to build that check's own per-row action name; the nonce itself is verified right after this returns.
		$value = $_REQUEST['id'] ?? null;
		$id    = is_string( $value ) || is_int( $value ) ? absint( $value ) : 0;
		if ( $id <= 0 ) {
			wp_die( esc_html__( 'Missing or invalid lead id.', 'moving-quote' ), 400 );
		}

		return $id;
	}

	private static function parse_status( string $raw ): ?LeadStatus {
		try {
			return '' === $raw ? null : LeadStatus::from( $raw );
		} catch ( \ValueError ) {
			return null;
		}
	}

	/**
	 * Anything but a plain string reads as `''`.
	 *
	 * @param array<string, mixed> $source
	 */
	private static function string_field( array $source, string $key ): string {
		$value = $source[ $key ] ?? null;
		return is_string( $value ) ? sanitize_text_field( wp_unslash( $value ) ) : '';
	}

	private static function redirect_to_list( string $notice ): void {
		wp_safe_redirect( add_query_arg( self::NOTICE_ARG, $notice, admin_url( 'admin.php?page=' . Menu::SLUG ) ) );
		exit;
	}
}
