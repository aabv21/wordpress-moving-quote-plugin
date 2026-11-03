<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

use Chivabox\MovingQuote\Leads\{LeadRecord, LeadRepository, LeadStatus, SyncStatus};
use Chivabox\MovingQuote\Rest\Messages;
use DateTimeImmutable;
use DateTimeZone;
use WP_List_Table;

/**
 * Renders the leads table: columns, status views with live counts, and paging. The caller
 * (`LeadsPage`) already required `wp-admin/includes/class-wp-list-table.php` before this class is
 * used, since that file isn't autoloaded by WordPress core.
 */
final class LeadsListTable extends WP_List_Table {
	public const PER_PAGE = 20;

	private readonly LeadRepository $repository;

	public function __construct() {
		parent::__construct(
			[
				'singular' => 'lead',
				'plural'   => 'leads',
				'ajax'     => false,
			]
		);
		$this->repository = new LeadRepository();
	}

	/** The `status` query arg, or null for "All" (also null for a value `LeadStatus` doesn't recognize). */
	public static function current_status(): ?LeadStatus {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a read-only filter, not a state change; no nonce to check.
		$value = $_GET['status'] ?? null;
		$raw   = is_string( $value ) ? sanitize_text_field( wp_unslash( $value ) ) : '';
		if ( '' === $raw ) {
			return null;
		}

		try {
			return LeadStatus::from( $raw );
		} catch ( \ValueError ) {
			return null;
		}
	}

	/** The current 1-based page number from the `paged` query arg, at least 1. */
	public static function current_page(): int {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- a read-only filter, not a state change; no nonce to check.
		$value = $_GET['paged'] ?? null;
		$raw   = is_string( $value ) || is_int( $value ) ? absint( $value ) : 1;
		return max( 1, $raw );
	}

	/** @return array<string, string> */
	public function get_columns(): array {
		return [
			'received_at' => __( 'Received', 'moving-quote' ),
			'reference'   => __( 'Reference', 'moving-quote' ),
			'customer'    => __( 'Customer', 'moving-quote' ),
			'move'        => _x( 'Move', 'leads table column: the move date, type, and rooms', 'moving-quote' ),
			'route'       => __( 'Route', 'moving-quote' ),
			'estimate'    => __( 'Estimate', 'moving-quote' ),
			'status'      => __( 'Status', 'moving-quote' ),
			'delivery'    => __( 'Delivery', 'moving-quote' ),
		];
	}

	/**
	 * The status views ("All", "New", "Contacted", …), each with its own live count and a link
	 * that keeps the view on page 1. Keyed `'all'` for the unfiltered view, by `LeadStatus::value`
	 * for the rest — `null` would collapse to `''` as an array key, so the unfiltered case is kept
	 * as its own explicit entry instead of sharing the loop below.
	 *
	 * @return array<string, string>
	 */
	protected function get_views(): array {
		$counts  = $this->repository->count_by_status();
		$current = self::current_status();
		$base    = admin_url( 'admin.php?page=' . Menu::SLUG );

		$views        = [];
		$views['all'] = self::view_link( $base, null === $current, _x( 'All', 'leads list view', 'moving-quote' ), $counts['all'] ?? 0 );
		foreach ( LeadStatus::cases() as $case ) {
			$url                   = add_query_arg( 'status', $case->value, $base );
			$views[ $case->value ] = self::view_link( $url, $current === $case, self::status_label( $case ), $counts[ $case->value ] ?? 0 );
		}

		return $views;
	}

	private static function view_link( string $url, bool $is_current, string $label, int $count ): string {
		return sprintf(
			'<a href="%s"%s>%s <span class="count">(%s)</span></a>',
			esc_url( $url ),
			$is_current ? ' class="current"' : '',
			esc_html( $label ),
			esc_html( (string) $count )
		);
	}

	public function prepare_items(): void {
		$status = self::current_status();
		$page   = self::current_page();

		$counts      = $this->repository->count_by_status();
		$total       = $counts[ null === $status ? 'all' : $status->value ] ?? 0;
		$this->items = $this->repository->page( $status, $page, self::PER_PAGE );

		$this->_column_headers = [ $this->get_columns(), [], [] ];
		$this->set_pagination_args(
			[
				'total_items' => $total,
				'per_page'    => self::PER_PAGE,
			]
		);
	}

	/**
	 * Every real column has its own `column_$name` method, dispatched by `single_row_columns()`
	 * below; this only runs for a column this table never declares.
	 *
	 * @param object|array<string, mixed> $item
	 */
	protected function column_default( $item, $column_name ): string {
		return '';
	}

	private function column_received_at( LeadRecord $lead ): string {
		$local = ( new DateTimeImmutable( $lead->created_at, new DateTimeZone( 'UTC' ) ) )->setTimezone( new DateTimeZone( 'America/Bogota' ) );
		return esc_html( $local->format( 'Y-m-d H:i' ) );
	}

	private function column_reference( LeadRecord $lead ): string {
		return esc_html( $lead->reference() );
	}

	private function column_customer( LeadRecord $lead ): string {
		return sprintf(
			'%s<br />%s<br />%s',
			esc_html( $lead->customer_name ),
			esc_html( $lead->phone ),
			esc_html( $lead->email )
		);
	}

	private function column_move( LeadRecord $lead ): string {
		return sprintf(
			'%s<br />%s<br />%s',
			esc_html( $lead->move_date ),
			esc_html( self::move_type_label( $lead->move_type ) ),
			esc_html(
				sprintf(
					/* translators: %d: number of rooms */
					_n( '%d room', '%d rooms', $lead->rooms, 'moving-quote' ),
					$lead->rooms
				)
			)
		);
	}

	private function column_route( LeadRecord $lead ): string {
		return sprintf(
			'%s %s %s<br />%s',
			esc_html( $lead->origin_city ),
			esc_html( "\u{2192}" ),
			esc_html( $lead->destination_city ),
			esc_html(
				sprintf(
					/* translators: %s: distance in kilometres, already formatted for the site language */
					__( '%s km', 'moving-quote' ),
					number_format_i18n( $lead->distance_km )
				)
			)
		);
	}

	private function column_estimate( LeadRecord $lead ): string {
		return esc_html( Messages::display( new \Chivabox\MovingQuote\Pricing\Estimate( $lead->estimate_cop, $lead->estimate_low_cop, $lead->estimate_high_cop, $lead->distance_km ) ) );
	}

	/** The status column: a per-row form with a select and an "Update" button, submitting straight to `admin-post.php`, plus a "Delete" link below it. */
	private function column_status( LeadRecord $lead ): string {
		$options = '';
		foreach ( LeadStatus::cases() as $case ) {
			$options .= sprintf(
				'<option value="%s"%s>%s</option>',
				esc_attr( $case->value ),
				$case === $lead->status ? ' selected="selected"' : '',
				esc_html( self::status_label( $case ) )
			);
		}

		$delete_url = wp_nonce_url(
			add_query_arg(
				[
					'action' => 'moving_quote_delete_lead',
					'id'     => $lead->id,
				],
				admin_url( 'admin-post.php' )
			),
			'moving_quote_delete_lead_' . $lead->id
		);

		return sprintf(
			'<form method="post" action="%1$s">
				<input type="hidden" name="action" value="moving_quote_update_status" />
				<input type="hidden" name="id" value="%2$d" />
				%3$s
				<label class="screen-reader-text" for="moving-quote-status-%2$d">%9$s</label>
				<select id="moving-quote-status-%2$d" name="status">%4$s</select>
				<button type="submit" class="button">%5$s</button>
			</form>
			<a href="%6$s" class="submitdelete" onclick="return confirm(%7$s)">%8$s</a>',
			esc_url( admin_url( 'admin-post.php' ) ),
			$lead->id,
			wp_nonce_field( 'moving_quote_update_status_' . $lead->id, '_wpnonce', true, false ),
			$options,
			esc_html_x( 'Update', 'button: save the selected lead status', 'moving-quote' ),
			esc_url( $delete_url ),
			esc_attr( (string) wp_json_encode( __( 'Delete this lead? This cannot be undone.', 'moving-quote' ) ) ),
			esc_html__( 'Delete', 'moving-quote' ),
			esc_html(
				sprintf(
					/* translators: %s: the lead's reference, e.g. MQ-1A2B3C4D */
					__( 'Status of lead %s', 'moving-quote' ),
					$lead->reference()
				)
			)
		);
	}

	/** The delivery column: the sync label, attempts, `last_error` visible as small text (also kept in a `title`), and a "Retry delivery" link on `failed` rows. */
	private function column_delivery( LeadRecord $lead ): string {
		$label = sprintf(
			/* translators: 1: delivery status label (Pending, Sent, or Failed), 2: attempt count */
			_n( '%1$s (%2$d attempt)', '%1$s (%2$d attempts)', $lead->attempts, 'moving-quote' ),
			self::sync_label( $lead->sync_status ),
			$lead->attempts
		);

		$html = sprintf( '<span title="%s">%s</span>', esc_attr( $lead->last_error ), esc_html( $label ) );

		if ( '' !== $lead->last_error ) {
			$html .= sprintf( '<br /><small>%s</small>', esc_html( $lead->last_error ) );
		}

		if ( SyncStatus::Failed === $lead->sync_status ) {
			$retry_url = wp_nonce_url(
				add_query_arg(
					[
						'action' => 'moving_quote_retry_delivery',
						'id'     => $lead->id,
					],
					admin_url( 'admin-post.php' )
				),
				'moving_quote_retry_delivery_' . $lead->id
			);
			$html     .= sprintf( '<br /><a href="%s">%s</a>', esc_url( $retry_url ), esc_html__( 'Retry delivery', 'moving-quote' ) );
		}

		return $html;
	}

	/**
	 * Dispatches to this table's own `column_$name` methods, which WP_List_Table's generic
	 * dispatch can't call directly: they're typed to take a `LeadRecord`, not the `object|array`
	 * the base class declares. Each cell keeps the markup core's own dispatch gives it: a
	 * `data-colname` label, and for the primary column (core's default, the first one: Received) a
	 * `<th scope="row">` row header with the `column-primary` class and the "Show more details"
	 * toggle. Core's narrow-screen stylesheet keys on exactly that markup, so the list collapses into
	 * one line per lead that expands into labelled rows, instead of a stack of unlabelled values.
	 *
	 * @param object|array<string, mixed> $item
	 */
	protected function single_row_columns( $item ): void {
		if ( ! $item instanceof LeadRecord ) {
			return;
		}

		$primary = $this->get_primary_column_name();
		foreach ( $this->get_columns() as $column_name => $column_label ) {
			$method     = 'column_' . $column_name;
			$value      = method_exists( $this, $method ) ? $this->$method( $item ) : '';
			$classes    = $column_name . ' column-' . $column_name;
			$is_primary = $primary === $column_name;
			if ( $is_primary ) {
				$classes .= ' has-row-actions column-primary';
				// Core's own toggle button: the same markup and text WP_List_Table gives every primary column.
				$value .= $this->handle_row_actions( $item, $column_name, $primary );
			}
			// Each column_$name() method above already escapes every dynamic value it includes
			// (esc_html/esc_attr/esc_url); wp_kses_post() would strip the column's own <form>,
			// <select>, and hidden <input> markup, which aren't in its allowed post-content tag list.
			printf(
				'<%1$s class="%2$s" data-colname="%3$s">%4$s</%5$s>',
				$is_primary ? 'th scope="row"' : 'td',
				esc_attr( $classes ),
				esc_attr( wp_strip_all_tags( $column_label ) ),
				$value, // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- pre-escaped HTML built by this class's own column_$name() methods (and core's own toggle button), not raw user input.
				$is_primary ? 'th' : 'td'
			);
		}
	}

	/** The display label for a stored move type, or the raw value for one this plugin version doesn't know. */
	public static function move_type_label( string $move_type ): string {
		$labels = [
			'apartment' => __( 'Apartment', 'moving-quote' ),
			'house'     => __( 'House', 'moving-quote' ),
			'office'    => __( 'Office', 'moving-quote' ),
		];
		return $labels[ $move_type ] ?? $move_type;
	}

	/** The display label for a stored extra, or the raw value for one this plugin version doesn't know. */
	public static function extra_label( string $extra ): string {
		$labels = [
			'packing'            => __( 'Packing', 'moving-quote' ),
			'furniture_assembly' => __( 'Furniture disassembly and assembly', 'moving-quote' ),
			'storage'            => __( 'Temporary storage', 'moving-quote' ),
			'piano_fragile'      => __( 'Piano or fragile items', 'moving-quote' ),
		];
		return $labels[ $extra ] ?? $extra;
	}

	/** A lead's lifecycle status label. Context-tagged: "New" or "Won" agree in gender with "lead" in some languages. */
	public static function status_label( LeadStatus $status ): string {
		$labels = [
			LeadStatus::New->value       => _x( 'New', 'lead status', 'moving-quote' ),
			LeadStatus::Contacted->value => _x( 'Contacted', 'lead status', 'moving-quote' ),
			LeadStatus::Quoted->value    => _x( 'Quoted', 'lead status', 'moving-quote' ),
			LeadStatus::Won->value       => _x( 'Won', 'lead status', 'moving-quote' ),
			LeadStatus::Lost->value      => _x( 'Lost', 'lead status', 'moving-quote' ),
		];
		return $labels[ $status->value ];
	}

	/** A lead's delivery status label. Context-tagged: "Sent" or "Failed" alone don't say what was sent. */
	public static function sync_label( SyncStatus $status ): string {
		$labels = [
			SyncStatus::Pending->value => _x( 'Pending', 'delivery status', 'moving-quote' ),
			SyncStatus::Sent->value    => _x( 'Sent', 'delivery status', 'moving-quote' ),
			SyncStatus::Failed->value  => _x( 'Failed', 'delivery status', 'moving-quote' ),
		];
		return $labels[ $status->value ];
	}
}
