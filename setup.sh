#!/usr/bin/env bash
# Installs and configures WordPress idempotently. Run `docker compose up -d --wait` first.
#
# The site is bilingual through Polylang: every page and the header menu exist in English (en_US)
# and Spanish (es_CO), linked as translations, with an EN | ES switcher in the header. SITE_LOCALE
# (.env or the command line) picks the default language, served without a URL prefix: en_US
# (default) or es_CO. The other one lives under /es/ or /en/. Polylang and WordPress's Spanish core
# pack download from wordpress.org, so this needs network access. Example: SITE_LOCALE=es_CO ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

# A SITE_LOCALE given on the command line wins over the one in .env, which is read next.
site_locale="${SITE_LOCALE:-}"

if [ ! -f .env ]; then
  echo "setup.sh: .env not found; run node scripts/init-env.ts first" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
. ./.env
set +a

wp() {
  docker compose exec -T wpcli wp "$@"
}

# `db` can report healthy while its init server listens only on a Unix socket. Probe with PHP's
# mysqli: the image's MariaDB client (behind `wp db check`) rejects MySQL 8.4's self-signed cert.
# Single-quoted on purpose: this is PHP, read through getenv(), not a shell variable.
# shellcheck disable=SC2016
db_probe='try {
  $link = mysqli_connect( getenv( "WORDPRESS_DB_HOST" ), getenv( "WORDPRESS_DB_USER" ), getenv( "WORDPRESS_DB_PASSWORD" ), getenv( "WORDPRESS_DB_NAME" ) );
  mysqli_close( $link );
} catch ( Throwable $e ) {
  fwrite( STDERR, $e->getMessage() );
  exit( 1 );
}'
db_check_tries=30
db_check_try=0
until wp eval "$db_probe" --skip-wordpress >/dev/null 2>&1; do
  db_check_try=$((db_check_try + 1))
  if [ "$db_check_try" -ge "$db_check_tries" ]; then
    echo "setup.sh: database did not become ready after ${db_check_tries} tries" >&2
    exit 1
  fi
  sleep 2
done

site_locale="${site_locale:-${SITE_LOCALE:-en_US}}"
case "$site_locale" in
  en_US) default_lang="en" ;;
  es_CO) default_lang="es" ;;
  *)
    echo "setup.sh: SITE_LOCALE must be en_US or es_CO, got ${site_locale}" >&2
    exit 1
    ;;
esac

# Exact, so every stack runs the same Polylang. Bump it deliberately, after reading its changelog.
polylang_version="3.9.1"

# Sets one language's page copy. Both languages always exist, so every run uses both sets.
load_copy() {
  case "$1" in
    en_US)
      tagline="Moving across Colombia's Caribbean coast"
      home_title="Home"
      home_heading="Moving made simple on Colombia's Caribbean coast"
      home_intro="Chivabox Movers moves homes and offices between Barranquilla, Cartagena, Santa Marta, and the rest of the coast. Get an instant estimate in under a minute."
      home_button="Get a quote"
      quote_title="Get a Quote"
      quote_intro="Tell us about your move and see an estimate right away."
      thanks_title="Thank You"
      thanks_intro="We received your moving request."
      thanks_heading="What happens next"
      thanks_step_1="We email you a summary of your request and your estimate."
      thanks_step_2="A member of our team calls you to confirm the details."
      thanks_step_3="We confirm the final price after a visit or video call, then book your moving day."
      thanks_button="Back to the home page"
      nav_home="Home"
      nav_quote="Get a Quote"
      ;;
    es_CO)
      tagline="Mudanzas en la costa Caribe colombiana"
      home_title="Inicio"
      home_heading="Su mudanza, sin complicaciones, en la costa Caribe de Colombia"
      home_intro="Chivabox Movers traslada hogares y oficinas entre Barranquilla, Cartagena, Santa Marta y el resto de la costa. Obtenga un precio estimado en menos de un minuto."
      home_button="Cotizar mi mudanza"
      quote_title="Cotice su mudanza"
      quote_intro="Cuéntenos sobre su mudanza y vea un precio estimado al instante."
      thanks_title="Gracias"
      thanks_intro="Recibimos su solicitud de mudanza."
      thanks_heading="Qué sigue"
      thanks_step_1="Le enviamos por correo un resumen de su solicitud y el precio estimado."
      thanks_step_2="Una persona de nuestro equipo se comunica con usted para confirmar los detalles."
      thanks_step_3="Confirmamos el precio final después de una visita o una videollamada y agendamos el día de su mudanza."
      thanks_button="Volver al inicio"
      nav_home="Inicio"
      nav_quote="Cotizar"
      ;;
  esac
}

# Sets one language's slugs. Polylang (free) needs a distinct slug per language. The quote form's
# default thank_you slug is the English one, and the plugin redirects to its translation.
load_slugs() {
  case "$1" in
    en)
      home_slug="home"
      quote_slug="get-a-quote"
      thanks_slug="thank-you"
      nav_slug="primary-navigation"
      nav_title="Primary navigation"
      ;;
    es)
      home_slug="inicio"
      quote_slug="cotizar"
      thanks_slug="gracias"
      nav_slug="navegacion-principal"
      nav_title="Navegación principal"
      ;;
  esac
}

# A page's URL path in a language, or that language's home page for an empty slug. Polylang serves
# the default language without a prefix and the other one under /<code>/.
lang_path() {
  local prefix=""
  if [ "$1" != "$default_lang" ]; then
    prefix="/$1"
  fi
  if [ -z "$2" ]; then
    echo "${prefix}/"
  else
    echo "${prefix}/$2/"
  fi
}

# The same path as written when the other language was the default, which is what an earlier run
# with the other SITE_LOCALE stored in the links below.
previous_lang_path() {
  local current="$default_lang"
  if [ "$default_lang" = "en" ]; then default_lang="es"; else default_lang="en"; fi
  lang_path "$@"
  default_lang="$current"
}

for name in WP_URL WP_ADMIN_USER WP_ADMIN_PASSWORD WP_ADMIN_EMAIL LEAD_WEBHOOK_SECRET TEAM_EMAIL; do
  if [ -z "${!name:-}" ]; then
    echo "setup.sh: ${name} is not set; run node scripts/init-env.ts and fill in .env first" >&2
    exit 1
  fi
done

if ! wp core is-installed >/dev/null 2>&1; then
  # `--prompt` keeps the password off argv, but readline() echoes a piped answer to stdout, so
  # stdout goes to /dev/null. Errors still reach stderr, and `set -e` still catches a failure.
  wp core install \
    --url="$WP_URL" \
    --title="Chivabox Movers" \
    --admin_user="$WP_ADMIN_USER" \
    --admin_email="$WP_ADMIN_EMAIL" \
    --skip-email \
    --prompt=admin_password >/dev/null <<EOF
$WP_ADMIN_PASSWORD
EOF
fi

# The language comes first, so everything after it runs in the site's own language. The Spanish
# core pack is always installed, since the Spanish pages need it whatever the default language.
if ! wp language core is-installed es_CO >/dev/null 2>&1; then
  wp language core install es_CO >/dev/null
fi
current_locale=$(wp eval 'echo get_locale();')
if [ "$current_locale" != "$site_locale" ]; then
  wp site switch-language "$site_locale" >/dev/null
fi

wp option update timezone_string "America/Bogota"
wp option update permalink_structure "/%postname%/"

default_theme=$(wp eval 'echo WP_DEFAULT_THEME;')
wp theme activate "$default_theme"

if wp post get 1 >/dev/null 2>&1; then
  wp post delete 1 --force >/dev/null
fi
if wp post get 2 >/dev/null 2>&1; then
  wp post delete 2 --force >/dev/null
fi

installed_polylang=""
if wp plugin is-installed polylang >/dev/null 2>&1; then
  installed_polylang=$(wp plugin get polylang --field=version)
fi
if [ "$installed_polylang" != "$polylang_version" ]; then
  wp plugin install polylang --version="$polylang_version" --force >/dev/null
fi
# On every run, not only after an install, so a copy that fails once is never activated later. A
# failed check removes the plugin, and the next run downloads it again.
if ! wp plugin verify-checksums polylang >/dev/null 2>&1; then
  wp plugin deactivate polylang >/dev/null 2>&1 || true
  wp plugin delete polylang >/dev/null
  echo "setup.sh: Polylang's files don't match their wordpress.org checksums, so it was removed; run ./setup.sh again to download it" >&2
  exit 1
fi
if ! wp plugin is-active polylang >/dev/null 2>&1; then
  wp plugin activate polylang >/dev/null
fi
# A first activation queues a redirect to Polylang's setup wizard, which this script replaces.
wp eval 'delete_transient( "pll_activation_redirect" );'

load_copy en_US
en_tagline="$tagline"
load_copy es_CO
es_tagline="$tagline"
if [ "$default_lang" = "en" ]; then
  other_lang="es" default_tagline="$en_tagline" other_tagline="$es_tagline"
else
  other_lang="en" default_tagline="$es_tagline" other_tagline="$en_tagline"
fi

# Both languages, in switcher order, the default one, and the tagline in each (through Polylang's
# string translations, since it's one option). Polylang (free) has no WP-CLI commands, so this
# calls its PHP API, with its arguments in $args.
wp eval-file - "$default_lang" "$default_tagline" "$other_lang" "$other_tagline" <<'PHP'
<?php
[ $default_lang, $default_tagline, $other_lang, $other_tagline ] = $args;
$languages = PLL()->model->languages;
foreach ( [ 'en_US', 'es_CO' ] as $order => $locale ) {
	if ( ! $languages->get( $locale ) ) {
		// The name, code, and flag come from Polylang's own list for the locale.
		$added = $languages->add( [ 'locale' => $locale, 'term_group' => $order ] );
		if ( is_wp_error( $added ) ) {
			fwrite( STDERR, "setup.sh: could not add {$locale}: " . $added->get_error_message() . "\n" );
			exit( 1 );
		}
	}
}
$errors = $languages->update_default( $default_lang );
if ( $errors->has_errors() ) {
	fwrite( STDERR, 'setup.sh: could not set the default language: ' . $errors->get_error_message() . "\n" );
	exit( 1 );
}

// Polylang can keep the stored tagline when the new one is its translation, so the stored source
// may be either language's copy: read it back, and map it to each language's own.
global $wpdb;
update_option( 'blogdescription', $default_tagline );
$source = (string) $wpdb->get_var( "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'blogdescription'" );
foreach ( [ $default_lang => $default_tagline, $other_lang => $other_tagline ] as $code => $tagline ) {
	$language = $languages->get( $code );
	$strings  = new PLL_MO();
	$strings->import_from_db( $language );
	$strings->add_entry( $strings->make_entry( $source, $tagline ) );
	$strings->export_to_db( $language );
}
PHP

# Without it, Polylang can't give a menu a language, and every visitor would get the newest menu.
if ! wp eval 'exit( pll_is_translated_post_type( "wp_navigation" ) ? 0 : 1 );' >/dev/null 2>&1; then
  echo "setup.sh: the header menus can't be translated; recreate the containers (docker compose up -d --wait) so they mount site/mu-plugins" >&2
  exit 1
fi

# Prints the ID of the post with this slug, creating it in that language when it's missing. An
# existing post is left as is, even if its content differs, since the owner may have edited it;
# one with no language yet (made before Polylang) gets this one.
# Arguments: language code, post type, slug, title, content.
ensure_post() {
  wp eval-file - "$@" <<'PHP'
<?php
[ $lang, $post_type, $slug, $title, $content ] = $args;
$existing = get_posts(
	[
		'post_type'   => $post_type,
		'name'        => $slug,
		'post_status' => 'any',
		'numberposts' => 1,
		'orderby'     => 'ID',
		'order'       => 'ASC',
		'fields'      => 'ids',
	]
);
if ( [] === $existing ) {
	$id = pll_insert_post(
		wp_slash(
			[
				'post_type'    => $post_type,
				'post_status'  => 'publish',
				'post_name'    => $slug,
				'post_title'   => $title,
				'post_content' => $content,
			]
		),
		$lang
	);
	if ( is_wp_error( $id ) ) {
		fwrite( STDERR, "setup.sh: could not create {$slug}: " . $id->get_error_message() . "\n" );
		exit( 1 );
	}
} else {
	$id = (int) $existing[0];
	if ( ! pll_get_post_language( $id ) ) {
		pll_set_post_language( $id, $lang );
	}
}
echo $id;
PHP
}

# A menu from before the switcher keeps its links and gets the switcher appended; that block is
# the one thing this script adds to an existing post.
# Arguments: the menu's ID, the switcher block.
ensure_switcher() {
  wp eval-file - "$@" <<'PHP'
<?php
[ $id, $switcher ] = $args;
$menu = get_post( (int) $id );
if ( $menu instanceof WP_Post && ! has_block( 'polylang/navigation-language-switcher', $menu ) ) {
	$updated = wp_update_post( wp_slash( [ 'ID' => $menu->ID, 'post_content' => $menu->post_content . "\n" . $switcher ] ), true );
	if ( is_wp_error( $updated ) ) {
		fwrite( STDERR, 'setup.sh: could not add the language switcher: ' . $updated->get_error_message() . "\n" );
		exit( 1 );
	}
}
PHP
}

# Rewrites the links this script wrote under the other default language (an exact `href="…"` or
# menu `"url":"…"` match), so a changed SITE_LOCALE never leaves a menu or button pointing at the
# other language's pages. Any other link, the owner's own included, stays as it is.
# Arguments: the post's ID, then pairs of old and new paths.
relink_post() {
  wp eval-file - "$@" <<'PHP'
<?php
$id    = (int) array_shift( $args );
$post  = get_post( $id );
$pairs = [];
foreach ( array_chunk( $args, 2 ) as [ $old, $new ] ) {
	$pairs[ 'href="' . $old . '"' ]  = 'href="' . $new . '"';
	$pairs[ '"url":"' . $old . '"' ] = '"url":"' . $new . '"';
}
if ( $post instanceof WP_Post ) {
	$content = strtr( $post->post_content, $pairs );
	if ( $content !== $post->post_content ) {
		$updated = wp_update_post( wp_slash( [ 'ID' => $id, 'post_content' => $content ] ), true );
		if ( is_wp_error( $updated ) ) {
			fwrite( STDERR, "setup.sh: could not update the links in post {$id}: " . $updated->get_error_message() . "\n" );
			exit( 1 );
		}
	}
}
PHP
}

# Links one post per language as translations of each other. Idempotent.
# Arguments: the English ID, the Spanish ID.
link_translations() {
  wp eval-file - "$@" <<'PHP'
<?php
pll_save_post_translations( [ 'en' => (int) $args[0], 'es' => (int) $args[1] ] );
PHP
}

# Codes, not names, so the header reads "EN ES", the current language marked.
switcher_block='<!-- wp:polylang/navigation-language-switcher {"show_labels":"codes"} /-->'

en_ids=()
es_ids=()
for locale in en_US es_CO; do
  lang="${locale%%_*}"
  load_copy "$locale"
  load_slugs "$lang"
  home_path=$(lang_path "$lang" "")
  quote_path=$(lang_path "$lang" "$quote_slug")

  home_id=$(ensure_post "$lang" page "$home_slug" "$home_title" "<!-- wp:heading --><h2>${home_heading}</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>${home_intro}</p><!-- /wp:paragraph -->
<!-- wp:buttons --><div class=\"wp-block-buttons\"><!-- wp:button --><div class=\"wp-block-button\"><a class=\"wp-block-button__link wp-element-button\" href=\"${quote_path}\">${home_button}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->")

  # The English thank_you slug resolves to this language's page through its translation.
  quote_id=$(ensure_post "$lang" page "$quote_slug" "$quote_title" "<!-- wp:paragraph --><p>${quote_intro}</p><!-- /wp:paragraph -->
<!-- wp:shortcode -->[moving_quote]<!-- /wp:shortcode -->")

  thanks_id=$(ensure_post "$lang" page "$thanks_slug" "$thanks_title" "<!-- wp:paragraph --><p>${thanks_intro}</p><!-- /wp:paragraph -->
<!-- wp:shortcode -->[moving_quote_reference]<!-- /wp:shortcode -->
<!-- wp:heading --><h2 class=\"wp-block-heading\">${thanks_heading}</h2><!-- /wp:heading -->
<!-- wp:list {\"ordered\":true} --><ol class=\"wp-block-list\"><!-- wp:list-item --><li>${thanks_step_1}</li><!-- /wp:list-item --><!-- wp:list-item --><li>${thanks_step_2}</li><!-- /wp:list-item --><!-- wp:list-item --><li>${thanks_step_3}</li><!-- /wp:list-item --></ol><!-- /wp:list -->
<!-- wp:buttons --><div class=\"wp-block-buttons\"><!-- wp:button --><div class=\"wp-block-button\"><a class=\"wp-block-button__link wp-element-button\" href=\"${home_path}\">${thanks_button}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->")

  # The theme's header navigation falls back to listing every page (the thank-you page included)
  # when no navigation menu exists, so each language gets its own: Home, Get a Quote, and the
  # switcher. Polylang filters the theme's menu lookup by language (site/mu-plugins/).
  nav_id=$(ensure_post "$lang" wp_navigation "$nav_slug" "$nav_title" "<!-- wp:navigation-link {\"label\":\"${nav_home}\",\"url\":\"${home_path}\",\"kind\":\"custom\",\"isTopLevelLink\":true} /-->
<!-- wp:navigation-link {\"label\":\"${nav_quote}\",\"url\":\"${quote_path}\",\"kind\":\"custom\",\"isTopLevelLink\":true} /-->
${switcher_block}")
  ensure_switcher "$nav_id" "$switcher_block"

  previous_home_path=$(previous_lang_path "$lang" "")
  previous_quote_path=$(previous_lang_path "$lang" "$quote_slug")
  relink_post "$home_id" "$previous_quote_path" "$quote_path"
  relink_post "$thanks_id" "$previous_home_path" "$home_path"
  relink_post "$nav_id" "$previous_home_path" "$home_path" "$previous_quote_path" "$quote_path"

  if [ "$lang" = "en" ]; then
    en_ids=("$home_id" "$quote_id" "$thanks_id" "$nav_id")
  else
    es_ids=("$home_id" "$quote_id" "$thanks_id" "$nav_id")
  fi
  if [ "$lang" = "$default_lang" ]; then
    front_page_id="$home_id"
  fi
done

for i in "${!en_ids[@]}"; do
  link_translations "${en_ids[$i]}" "${es_ids[$i]}"
done

# Polylang shows the front page's translation for the other language, at /es/ or /en/.
wp option update show_on_front page
wp option update page_on_front "$front_page_id"

wp plugin activate moving-quote

# The secret and team email go through STDIN, never the command line (`ps`, shell history);
# `option patch update` doesn't echo a piped value.
wp option patch update moving_quote_settings webhook_url "http://n8n:5678/webhook/moving-quote/leads"
wp option patch update moving_quote_settings webhook_secret <<< "$LEAD_WEBHOOK_SECRET"
wp option patch update moving_quote_settings team_email <<< "$TEAM_EMAIL"

# Last, so the rules include Polylang's language prefixes and the front page.
wp rewrite flush --hard

admin_url="${WP_URL%/}/wp-admin/"
echo "Site: $WP_URL"
echo "Other language: ${WP_URL%/}$(lang_path "$other_lang" "")"
echo "Admin: $admin_url"
