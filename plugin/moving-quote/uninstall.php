<?php
/**
 * Runs only when WordPress deletes the plugin, never on deactivation.
 *
 * @package Chivabox\MovingQuote
 */

declare(strict_types=1);

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

require __DIR__ . '/vendor/autoload.php';

\Chivabox\MovingQuote\Install\Uninstaller::uninstall();
