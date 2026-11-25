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

$chivabox_quote_url = chivabox_page_url( 'get-a-quote' );
$chivabox_images    = get_theme_file_uri( 'assets/images/' );
?>
<!-- wp:group {"tagName":"section","className":"chivabox-section chivabox-hero","layout":{"type":"default"}} -->
<section class="wp-block-group chivabox-section chivabox-hero"><!-- wp:columns {"verticalAlignment":"center","className":"chivabox-hero__columns"} -->
<div class="wp-block-columns are-vertically-aligned-center chivabox-hero__columns"><!-- wp:column {"verticalAlignment":"center","width":"56%","className":"chivabox-hero__copy"} -->
<div class="wp-block-column is-vertically-aligned-center chivabox-hero__copy" style="flex-basis:56%"><!-- wp:heading {"level":1,"className":"chivabox-hero__title"} -->
<h1 class="wp-block-heading chivabox-hero__title"><?php esc_html_e( 'Moving on the Caribbean coast, done right', 'chivabox' ); ?></h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"chivabox-hero__lead"} -->
<p class="chivabox-hero__lead"><?php esc_html_e( 'Homes and offices between Barranquilla, Cartagena and Santa Marta. See your price in under a minute.', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:html -->
<div class="chivabox-actions"><?php chivabox_shortcode( 'moving_quote_contact', 'layout="whatsapp"' ); ?><?php chivabox_shortcode( 'moving_quote_contact', 'layout="phone"' ); ?></div>
<!-- /wp:html --></div>
<!-- /wp:column -->

<!-- wp:column {"verticalAlignment":"center","width":"44%","className":"chivabox-hero__start"} -->
<div class="wp-block-column is-vertically-aligned-center chivabox-hero__start" style="flex-basis:44%"><!-- wp:html -->
<?php chivabox_shortcode( 'moving_quote_start' ); ?>
<!-- /wp:html --></div>
<!-- /wp:column --></div>
<!-- /wp:columns -->

<!-- wp:html -->
<figure class="chivabox-hero__photo"><img src="<?php echo esc_url( $chivabox_images . 'hero-crew.webp' ); ?>" srcset="<?php echo esc_url( $chivabox_images . 'hero-crew-800.webp' ); ?> 800w, <?php echo esc_url( $chivabox_images . 'hero-crew.webp' ); ?> 1600w" sizes="(min-width: 1264px) 1200px, calc(100vw - 2rem)" width="1600" height="1067" alt="<?php esc_attr_e( 'A mover pushing a tall stack of moving boxes on a hand truck', 'chivabox' ); ?>" fetchpriority="high" decoding="async" /></figure>
<!-- /wp:html -->

<!-- wp:list {"className":"chivabox-trust"} -->
<ul class="wp-block-list chivabox-trust"><!-- wp:list-item -->
<li><?php esc_html_e( 'Cargo insurance on every move', 'chivabox' ); ?></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><?php esc_html_e( 'Final price in writing after a visit', 'chivabox' ); ?></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><?php esc_html_e( 'Reply within one business hour', 'chivabox' ); ?></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><?php esc_html_e( 'Trained, uniformed crews', 'chivabox' ); ?></li>
<!-- /wp:list-item --></ul>
<!-- /wp:list --></section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"chivabox-section chivabox-steps","layout":{"type":"default"}} -->
<section class="wp-block-group chivabox-section chivabox-steps"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'How it works', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:list {"ordered":true,"className":"chivabox-steps__list"} -->
<ol class="wp-block-list chivabox-steps__list"><!-- wp:list-item -->
<li><strong><?php esc_html_e( 'Get your estimate', 'chivabox' ); ?></strong> <?php esc_html_e( 'Answer three short steps and see a price range right away.', 'chivabox' ); ?></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong><?php esc_html_e( 'Confirm the details', 'chivabox' ); ?></strong> <?php esc_html_e( 'We call you, or meet by video call, and send the final price in writing.', 'chivabox' ); ?></li>
<!-- /wp:list-item -->

<!-- wp:list-item -->
<li><strong><?php esc_html_e( 'Move day', 'chivabox' ); ?></strong> <?php esc_html_e( 'Our crew packs, loads and delivers on the date you booked.', 'chivabox' ); ?></li>
<!-- /wp:list-item --></ol>
<!-- /wp:list --></section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"chivabox-section chivabox-services","layout":{"type":"default"}} -->
<section class="wp-block-group chivabox-section chivabox-services"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'What we move', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:group {"className":"chivabox-services__grid","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-services__grid"><!-- wp:group {"className":"chivabox-service chivabox-service--homes","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-service chivabox-service--homes"><!-- wp:html -->
<img class="chivabox-service__photo" src="<?php echo esc_url( $chivabox_images . 'service-homes.webp' ); ?>" width="1200" height="800" alt="<?php esc_attr_e( 'Labeled moving boxes stacked by a living room window', 'chivabox' ); ?>" loading="lazy" decoding="async" />
<!-- /wp:html -->

<!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading"><?php esc_html_e( 'Homes', 'chivabox' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'Apartments and houses, from a studio to five rooms and more.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:group {"className":"chivabox-service chivabox-service--offices","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-service chivabox-service--offices"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading"><?php esc_html_e( 'Offices', 'chivabox' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'Desks, files and equipment, moved after hours so you lose no workday.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:group {"className":"chivabox-service chivabox-service--packing","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-service chivabox-service--packing"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading"><?php esc_html_e( 'Packing', 'chivabox' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'We bring boxes, wrap and labels, and pack room by room.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:group {"className":"chivabox-service chivabox-service--storage","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-service chivabox-service--storage"><!-- wp:heading {"level":3} -->
<h3 class="wp-block-heading"><?php esc_html_e( 'Storage', 'chivabox' ); ?></h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'Short-term storage when your new place isn\'t ready yet.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:group --></section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"chivabox-section chivabox-routes","layout":{"type":"default"}} -->
<section class="wp-block-group chivabox-section chivabox-routes"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'Popular routes', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"chivabox-section__lead"} -->
<p class="chivabox-section__lead"><?php esc_html_e( 'Prices from, for a one-room apartment with no extras.', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:html -->
<?php chivabox_shortcode( 'moving_quote_routes' ); ?>
<!-- /wp:html --></section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"chivabox-section chivabox-reviews","layout":{"type":"default"}} -->
<section class="wp-block-group chivabox-section chivabox-reviews"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'What customers say', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"chivabox-section__lead"} -->
<p class="chivabox-section__lead"><?php esc_html_e( 'Sample reviews for this demo', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:group {"className":"chivabox-reviews__grid","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-reviews__grid"><!-- wp:quote {"className":"chivabox-review chivabox-review--featured"} -->
<blockquote class="wp-block-quote chivabox-review chivabox-review--featured"><!-- wp:paragraph {"className":"chivabox-review__route"} -->
<p class="chivabox-review__route"><?php esc_html_e( 'Barranquilla → Cartagena, three-bedroom apartment', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'They moved our three-bedroom apartment from Barranquilla to Cartagena in one day, and the price matched the quote.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --><cite>Laura M., Cartagena</cite></blockquote>
<!-- /wp:quote -->

<!-- wp:quote {"className":"chivabox-review"} -->
<blockquote class="wp-block-quote chivabox-review"><!-- wp:paragraph {"className":"chivabox-review__route"} -->
<p class="chivabox-review__route"><?php esc_html_e( 'Within Santa Marta, house', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'The crew wrapped every piece of furniture and put the beds back together before leaving.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --><cite>Andrés P., Santa Marta</cite></blockquote>
<!-- /wp:quote -->

<!-- wp:quote {"className":"chivabox-review"} -->
<blockquote class="wp-block-quote chivabox-review"><!-- wp:paragraph {"className":"chivabox-review__route"} -->
<p class="chivabox-review__route"><?php esc_html_e( 'Barranquilla, office move', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><?php esc_html_e( 'We moved the office on a Saturday and were working on Monday morning.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --><cite>Valentina R., Barranquilla</cite></blockquote>
<!-- /wp:quote --></div>
<!-- /wp:group --></section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"chivabox-section chivabox-faq","layout":{"type":"default"}} -->
<section class="wp-block-group chivabox-section chivabox-faq"><!-- wp:group {"className":"chivabox-faq__intro","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-faq__intro"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'Questions', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"chivabox-faq__ask"} -->
<p class="chivabox-faq__ask"><strong><?php esc_html_e( 'Still have a question?', 'chivabox' ); ?></strong> <?php esc_html_e( 'Call us or write on WhatsApp. We reply within one business hour.', 'chivabox' ); ?></p>
<!-- /wp:paragraph -->

<!-- wp:html -->
<div class="chivabox-actions"><?php chivabox_shortcode( 'moving_quote_contact', 'layout="whatsapp"' ); ?><?php chivabox_shortcode( 'moving_quote_contact', 'layout="phone"' ); ?></div>
<!-- /wp:html --></div>
<!-- /wp:group -->

<!-- wp:group {"className":"chivabox-faq__list","layout":{"type":"default"}} -->
<div class="wp-block-group chivabox-faq__list"><!-- wp:details -->
<details class="wp-block-details"><summary><?php esc_html_e( 'Is the online price final?', 'chivabox' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'It\'s an estimate. We confirm the final price in writing after a short visit or video call.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary><?php esc_html_e( 'Which cities do you serve?', 'chivabox' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Barranquilla, Cartagena, Santa Marta, Valledupar, Montería, Sincelejo and Riohacha, and any move between them.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary><?php esc_html_e( 'Is my move insured?', 'chivabox' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Yes. Every move carries cargo insurance at no extra cost.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details -->

<!-- wp:details -->
<details class="wp-block-details"><summary><?php esc_html_e( 'How far ahead should I book?', 'chivabox' ); ?></summary><!-- wp:paragraph -->
<p><?php esc_html_e( 'Two weeks is ideal. For an earlier date, write to us on WhatsApp and we\'ll check the schedule.', 'chivabox' ); ?></p>
<!-- /wp:paragraph --></details>
<!-- /wp:details --></div>
<!-- /wp:group --></section>
<!-- /wp:group -->

<!-- wp:group {"tagName":"section","className":"chivabox-section chivabox-closing","layout":{"type":"default"}} -->
<section class="wp-block-group chivabox-section chivabox-closing"><!-- wp:heading -->
<h2 class="wp-block-heading"><?php esc_html_e( 'Ready when you are', 'chivabox' ); ?></h2>
<!-- /wp:heading -->

<!-- wp:html -->
<div class="chivabox-actions"><a class="wp-block-button__link wp-element-button" href="<?php echo esc_url( $chivabox_quote_url ); ?>"><?php esc_html_e( 'Get my quote', 'chivabox' ); ?></a><?php chivabox_shortcode( 'moving_quote_contact', 'layout="whatsapp"' ); ?><?php chivabox_shortcode( 'moving_quote_contact', 'layout="phone"' ); ?></div>
<!-- /wp:html --></section>
<!-- /wp:group -->
