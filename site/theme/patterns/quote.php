<?php
/**
 * Title: Quote
 * Slug: chivabox/quote
 * Categories: chivabox
 * Inserter: no
 *
 * @package Chivabox
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;
?>
<!-- wp:paragraph {"className":"chivabox-page-lead"} -->
<p class="chivabox-page-lead"><?php esc_html_e( 'Tell us about your move and see an estimate right away.', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:html -->
<?php chivabox_shortcode( 'moving_quote' ); ?>
<!-- /wp:html -->
