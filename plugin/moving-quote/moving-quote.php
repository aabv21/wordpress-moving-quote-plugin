<?php
/**
 * Plugin Name: Moving Quote
 * Description: Three-step moving quote form with live estimates, a leads list, and signed delivery to n8n.
 * Version: 1.2.0
 * Requires at least: 7.0
 * Requires PHP: 8.3
 * Author: Andrés Buelvas
 * License: MIT
 * License URI: https://opensource.org/licenses/MIT
 * Text Domain: moving-quote
 * Domain Path: /languages
 *
 * @package Chivabox\MovingQuote
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;

require __DIR__ . '/vendor/autoload.php';

\Chivabox\MovingQuote\Plugin::boot( __FILE__ );
