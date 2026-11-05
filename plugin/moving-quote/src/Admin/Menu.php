<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote\Admin;

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
			[ LeadsPage::class, 'render' ],
			'dashicons-car'
		);

		add_submenu_page(
			self::SLUG,
			__( 'Moving quotes', 'moving-quote' ),
			__( 'Leads', 'moving-quote' ),
			self::CAPABILITY,
			self::SLUG,
			[ LeadsPage::class, 'render' ]
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
}
