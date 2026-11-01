<?php
declare(strict_types=1);

namespace Chivabox\MovingQuote;

/**
 * Plugin entry point: wires bootstrap hooks for the main plugin file.
 */
final class Plugin {
	public const VERSION = '1.0.0';

	// phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- kept for register_activation_hook() in a later task.
	public static function boot( string $plugin_file ): void {
		add_action(
			'init',
			static function (): void {
				load_plugin_textdomain( 'moving-quote', false, 'moving-quote/languages' );
			}
		);
	}
}
