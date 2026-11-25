<?php
/**
 * Title: Footer
 * Slug: chivabox/footer
 * Categories: chivabox
 * Block Types: core/template-part/footer
 * Inserter: no
 *
 * @package Chivabox
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;
?>
<!-- wp:group {"className":"chivabox-footer","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-footer"><!-- wp:group {"className":"chivabox-footer__inner","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-footer__inner"><!-- wp:group {"className":"chivabox-footer__brand","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-footer__brand"><!-- wp:group {"className":"chivabox-brand","layout":{"type":"flex","flexWrap":"nowrap"}} -->
<div class="wp-block-group chivabox-brand"><!-- wp:html -->
<?php chivabox_logo(); ?>
<!-- /wp:html -->

<!-- wp:site-title {"level":0,"isLink":false} /--></div>
<!-- /wp:group -->

<!-- wp:site-tagline {"className":"chivabox-footer__tagline"} /--></div>
<!-- /wp:group -->

<!-- wp:html -->
<?php chivabox_shortcode( 'moving_quote_contact' ); ?>
<!-- /wp:html -->

<!-- wp:group {"className":"chivabox-footer__legal","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-footer__legal"><!-- wp:paragraph -->
<p><?php esc_html_e( 'Demo site, fictional company and tax ID.', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><?php echo esc_html( '© ' . gmdate( 'Y' ) . ' Chivabox Movers' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->
