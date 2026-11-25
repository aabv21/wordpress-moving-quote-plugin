<?php
/**
 * Title: Thank you
 * Slug: chivabox/thank-you
 * Categories: chivabox
 * Inserter: no
 *
 * @package Chivabox
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;
?>
<!-- wp:paragraph -->
<p><?php esc_html_e( 'We received your moving request.', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:shortcode -->
[moving_quote_reference]
<!-- /wp:shortcode -->

<!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'What happens next', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:list {"ordered":true} -->
<ol class="wp-block-list"><!-- wp:list-item -->
<li><?php esc_html_e( 'We email you a summary of your request and your estimate.', 'chivabox' ); ?></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><?php esc_html_e( 'A member of our team calls you to confirm the details.', 'chivabox' ); ?></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><?php esc_html_e( 'We confirm the final price after a visit or video call, then book your moving day.', 'chivabox' ); ?></li>
<!-- /wp:list-item --></ol>
<!-- /wp:list -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( chivabox_page_url( '' ) ); ?>"><?php esc_html_e( 'Back to the home page', 'chivabox' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->
