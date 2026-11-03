<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\{LeadRepository, LeadStatus};

/**
 * The Leads admin page: the list table, status updates, CSV export, and retrying a failed
 * delivery. Every handler checks `manage_options` before its nonce, so a user who can't reach the
 * page at all never gets a different error from a handler than from the page itself.
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

	/** Renders the list table and an "Export CSV" button that keeps the current status filter. */
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
			 * No wrapping <form method="get"> here on purpose: this table has no bulk actions and no
			 * search box, and WP_List_Table::display() already prints every row's own
			 * <form method="post" action="admin-post.php"> (see LeadsListTable::column_status()). HTML
			 * doesn't allow nested forms -- the parser drops a nested <form>'s own start tag, folding
			 * its controls into whichever form is still open, so a wrapping GET form here would
			 * silently fold the first row's status controls into itself, and that lead would never
			 * actually change status. Every pagination control is a plain link carrying its own query
			 * args (including `status`), except the "Current Page" number box, which has no form of
			 * its own to submit via Enter -- an accepted, minor loss next to a status update that
			 * silently never takes effect.
			 */
			?>
			<?php $table->views(); ?>
			<?php $table->display(); ?>
		</div>
		<?php
	}

	/** A core notice, shown once right after a redirect from one of this page's own handlers. */
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

	/** Updates one lead's lifecycle status, posted from the list table's per-row form. */
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

	/** Requeues a `failed` lead: back to `pending`, due immediately. A lead that isn't `failed` is left untouched. */
	public static function handle_retry(): void {
		$id = self::require_id();
		check_admin_referer( 'moving_quote_retry_delivery_' . $id );

		( new LeadRepository() )->requeue( $id, time() );

		self::redirect_to_list( 'retry_queued' );
	}

	/** Permanently deletes one lead row, checked the same way every other handler here is: `manage_options` first (inside `require_id()`), then this row's own nonce. */
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
			// Advance past the whole raw batch, including a trailing unparseable row that never
			// became a record: driving the loop from raw_count (not count($chunk['records'])) is
			// what keeps a batch with one bad row from looking like the last, short page and
			// stopping the export early; advancing the cursor by last_raw_id is what keeps that
			// same bad row from being re-fetched, and re-skipped, on every subsequent call.
			$after_id = $chunk['last_raw_id'];
		}

		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose -- streaming to php://output, not a filesystem path; WP_Filesystem has no equivalent.
		exit;
	}

	/** The `id` request field, as a positive int. Dies with 403 for a disallowed user, or 400 for a missing or non-numeric id. */
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
	 * A string field from a superglobal array, sanitized with `sanitize_text_field()` after
	 * `wp_unslash()`. Anything but a plain string (missing, an array, …) reads as `''`.
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
