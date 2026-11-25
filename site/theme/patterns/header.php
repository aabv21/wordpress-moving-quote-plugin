<?php
/**
 * Title: Header
 * Slug: chivabox/header
 * Categories: chivabox
 * Block Types: core/template-part/header
 * Inserter: no
 *
 * @package Chivabox
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || exit;
?>
<!-- wp:group {"className":"chivabox-header","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-header"><!-- wp:group {"className":"chivabox-header__inner","layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"space-between"}} -->
<div class="wp-block-group chivabox-header__inner"><!-- wp:group {"className":"chivabox-brand","layout":{"type":"flex","flexWrap":"nowrap"}} -->
<div class="wp-block-group chivabox-brand"><!-- wp:html -->
<?php chivabox_logo(); ?>
<!-- /wp:html -->

<!-- wp:site-title {"level":0} /--></div>
<!-- /wp:group -->

<!-- wp:group {"className":"chivabox-header__actions","layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"right"}} -->
<div class="wp-block-group chivabox-header__actions"><!-- wp:navigation {"overlayMenu":"mobile","className":"chivabox-nav","layout":{"type":"flex","justifyContent":"right"}} /-->

<!-- wp:html -->
<?php chivabox_shortcode( 'moving_quote_contact', 'layout="phone"' ); ?>
<?php chivabox_shortcode( 'moving_quote_contact', 'layout="whatsapp"' ); ?>
<!-- /wp:html --></div>
<!-- /wp:group --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->
