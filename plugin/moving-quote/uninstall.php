<?php
/**
 * Uninstall handler: runs only when the plugin is deleted through WordPress, never on a plain
 * file delete or a deactivation.
 *
 * @package Chivabox\MovingQuote
 */

declare(strict_types=1);

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

require __DIR__ . '/vendor/autoload.php';

\Chivabox\MovingQuote\Install\Uninstaller::uninstall();
