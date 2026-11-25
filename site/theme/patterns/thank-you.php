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
<!-- wp:columns {"className":"chivabox-thanks"} -->
<div class="wp-block-columns chivabox-thanks"><!-- wp:column {"width":"55%","className":"chivabox-thanks__card"} -->
<div class="wp-block-column chivabox-thanks__card" style="flex-basis:55%"><!-- wp:html -->
<?php chivabox_shortcode( 'moving_quote_thanks', 'heading="0"' ); ?>
<!-- /wp:html --></div>
<!-- /wp:column -->

<!-- wp:column {"width":"45%","className":"chivabox-thanks__next"} -->
<div class="wp-block-column chivabox-thanks__next" style="flex-basis:45%"><!-- wp:heading {"className":"chivabox-next-title"} -->
<h2 class="wp-block-heading chivabox-next-title"><?php esc_html_e( 'What happens next', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:list {"ordered":true,"className":"chivabox-next-list"} -->
<ol class="wp-block-list chivabox-next-list"><!-- wp:list-item -->
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
<div class="wp-block-buttons"><!-- wp:button {"className":"is-style-outline"} -->
<div class="wp-block-button is-style-outline"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( chivabox_page_url( '' ) ); ?>"><?php esc_html_e( 'Back to the home page', 'chivabox' ); ?></a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->
