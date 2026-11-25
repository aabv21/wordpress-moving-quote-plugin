<?php
/**
 * Title: Home
 * Slug: chivabox/home
 * Categories: chivabox
 * Inserter: no
 *
 * @package Chivabox
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;
?>
<!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'Moving made simple on Colombia\'s Caribbean coast', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'Chivabox Movers moves homes and offices between Barranquilla, Cartagena, Santa Marta, and the rest of the coast. Get an instant estimate in under a minute.', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( chivabox_page_url( 'get-a-quote' ) ); ?>"><?php esc_html_e( 'Get a quote', 'chivabox' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->
