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
			'move'        => __( 'Move', 'moving-quote' ),
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
		$views['all'] = self::view_link( $base, null === $current, __( 'All', 'moving-quote' ), $counts['all'] ?? 0 );
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
			esc_html( $lead->move_type ),
			esc_html( (string) $lead->rooms )
		);
	}

	private function column_route( LeadRecord $lead ): string {
		return sprintf(
			'%s %s %s<br />%s km',
			esc_html( $lead->origin_city ),
			esc_html( "\u{2192}" ),
			esc_html( $lead->destination_city ),
			esc_html( (string) $lead->distance_km )
		);
	}

	private function column_estimate( LeadRecord $lead ): string {
		return esc_html( Messages::display( new \Chivabox\MovingQuote\Pricing\Estimate( $lead->estimate_cop, $lead->estimate_low_cop, $lead->estimate_high_cop, $lead->distance_km ) ) );
	}

	/** The status column: a per-row form with a select and an "Update" button, submitting straight to `admin-post.php`. */
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

		return sprintf(
			'<form method="post" action="%1$s">
				<input type="hidden" name="action" value="moving_quote_update_status" />
				<input type="hidden" name="id" value="%2$d" />
				%3$s
				<select name="status">%4$s</select>
				<button type="submit" class="button">%5$s</button>
			</form>',
			esc_url( admin_url( 'admin-post.php' ) ),
			$lead->id,
			wp_nonce_field( 'moving_quote_update_status_' . $lead->id, '_wpnonce', true, false ),
			$options,
			esc_html__( 'Update', 'moving-quote' )
		);
	}

	/** The delivery column: the sync label, attempts, `last_error` in a `title`, and a "Retry delivery" link on `failed` rows. */
	private function column_delivery( LeadRecord $lead ): string {
		$label = sprintf(
			/* translators: 1: sync status label, 2: attempt count */
			__( '%1$s (%2$d attempts)', 'moving-quote' ),
			self::sync_label( $lead->sync_status ),
			$lead->attempts
		);

		$html = sprintf( '<span title="%s">%s</span>', esc_attr( $lead->last_error ), esc_html( $label ) );

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
	 * the base class declares.
	 *
	 * @param object|array<string, mixed> $item
	 */
	protected function single_row_columns( $item ): void {
		if ( ! $item instanceof LeadRecord ) {
			return;
		}

		foreach ( array_keys( $this->get_columns() ) as $column_name ) {
			$method = 'column_' . $column_name;
			$value  = method_exists( $this, $method ) ? $this->$method( $item ) : '';
			// Each column_$name() method above already escapes every dynamic value it includes
			// (esc_html/esc_attr/esc_url); wp_kses_post() would strip the column's own <form>,
			// <select>, and hidden <input> markup, which aren't in its allowed post-content tag list.
			printf( '<td class="%1$s column-%1$s">%2$s</td>', esc_attr( $column_name ), $value ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- $value is pre-escaped HTML built by this class's own column_$name() methods, not raw user input.
		}
	}

	public static function status_label( LeadStatus $status ): string {
		$labels = [
			LeadStatus::New->value       => __( 'New', 'moving-quote' ),
			LeadStatus::Contacted->value => __( 'Contacted', 'moving-quote' ),
			LeadStatus::Quoted->value    => __( 'Quoted', 'moving-quote' ),
			LeadStatus::Won->value       => __( 'Won', 'moving-quote' ),
			LeadStatus::Lost->value      => __( 'Lost', 'moving-quote' ),
		];
		return $labels[ $status->value ];
	}

	public static function sync_label( SyncStatus $status ): string {
		$labels = [
			SyncStatus::Pending->value => __( 'Pending', 'moving-quote' ),
			SyncStatus::Sent->value    => __( 'Sent', 'moving-quote' ),
			SyncStatus::Failed->value  => __( 'Failed', 'moving-quote' ),
		];
		return $labels[ $status->value ];
	}
}
