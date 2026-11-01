<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

/**
 * Registers the plugin's admin menu: the top-level "Moving quotes" page (leads list, built in a
 * later task) and its "Settings" submenu.
 */
final class Menu {
	public const CAPABILITY    = 'manage_options';
	public const SLUG          = 'moving-quote';
	public const SETTINGS_SLUG = 'moving-quote-settings';

	public static function register(): void {
		add_menu_page(
			__( 'Moving quotes', 'moving-quote' ),
			__( 'Moving quotes', 'moving-quote' ),
			self::CAPABILITY,
			self::SLUG,
			[ self::class, 'render_leads_placeholder' ],
			'dashicons-car'
		);

		add_submenu_page(
			self::SLUG,
			__( 'Moving quotes', 'moving-quote' ),
			__( 'Leads', 'moving-quote' ),
			self::CAPABILITY,
			self::SLUG,
			[ self::class, 'render_leads_placeholder' ]
		);

		add_submenu_page(
			self::SLUG,
			__( 'Moving Quote Settings', 'moving-quote' ),
			__( 'Settings', 'moving-quote' ),
			self::CAPABILITY,
			self::SETTINGS_SLUG,
			[ SettingsPage::class, 'render' ]
		);
	}

	/** Placeholder for the leads list page, built in a later task. */
	public static function render_leads_placeholder(): void {
		if ( ! current_user_can( self::CAPABILITY ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to access this page.', 'moving-quote' ) );
		}
		echo '<div class="wrap"><h1>' . esc_html__( 'Moving quotes', 'moving-quote' ) . '</h1></div>';
	}
}
