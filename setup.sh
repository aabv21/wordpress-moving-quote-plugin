#!/usr/bin/env bash
# Installs and configures WordPress idempotently. Run `docker compose up -d --wait` first.
#
# SITE_LOCALE (.env or the command line): en_US (default) or es_CO, which downloads WordPress's
# Spanish core pack and so needs network access. Example: SITE_LOCALE=es_CO ./setup.sh
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

# Slugs are the same in both languages, so the thank-you redirect and links always work.
case "$site_locale" in
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
  *)
    echo "setup.sh: SITE_LOCALE must be en_US or es_CO, got ${site_locale}" >&2
    exit 1
    ;;
esac

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

# The language comes first, so everything after it runs in the site's own language.
if [ "$site_locale" != "en_US" ] && ! wp language core is-installed "$site_locale" >/dev/null 2>&1; then
  wp language core install "$site_locale" >/dev/null
fi
current_locale=$(wp eval 'echo get_locale();')
if [ "$current_locale" != "$site_locale" ]; then
  wp site switch-language "$site_locale" >/dev/null
fi

wp option update blogdescription "$tagline"
wp option update timezone_string "America/Bogota"
wp option update permalink_structure "/%postname%/"
wp rewrite flush --hard

default_theme=$(wp eval 'echo WP_DEFAULT_THEME;')
wp theme activate "$default_theme"

if wp post get 1 >/dev/null 2>&1; then
  wp post delete 1 --force >/dev/null
fi
if wp post get 2 >/dev/null 2>&1; then
  wp post delete 2 --force >/dev/null
fi

# An existing post with the slug is left as is, even if its content differs: the owner may have
# edited it.
create_post_if_missing() {
  post_type="$1"
  slug="$2"
  title="$3"
  content="$4"
  existing=$(wp post list --post_type="$post_type" --name="$slug" --field=ID)
  if [ -z "$existing" ]; then
    wp post create --post_type="$post_type" --post_status=publish --post_title="$title" --post_name="$slug" --post_content="$content" >/dev/null
  fi
}

create_page_if_missing() {
  create_post_if_missing page "$@"
}

create_page_if_missing "home" "$home_title" "<!-- wp:heading --><h2>${home_heading}</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>${home_intro}</p><!-- /wp:paragraph -->
<!-- wp:buttons --><div class=\"wp-block-buttons\"><!-- wp:button --><div class=\"wp-block-button\"><a class=\"wp-block-button__link wp-element-button\" href=\"/get-a-quote/\">${home_button}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->"

create_page_if_missing "get-a-quote" "$quote_title" "<!-- wp:paragraph --><p>${quote_intro}</p><!-- /wp:paragraph -->
<!-- wp:shortcode -->[moving_quote]<!-- /wp:shortcode -->"

create_page_if_missing "thank-you" "$thanks_title" "<!-- wp:paragraph --><p>${thanks_intro}</p><!-- /wp:paragraph -->
<!-- wp:shortcode -->[moving_quote_reference]<!-- /wp:shortcode -->
<!-- wp:heading --><h2 class=\"wp-block-heading\">${thanks_heading}</h2><!-- /wp:heading -->
<!-- wp:list {\"ordered\":true} --><ol class=\"wp-block-list\"><!-- wp:list-item --><li>${thanks_step_1}</li><!-- /wp:list-item --><!-- wp:list-item --><li>${thanks_step_2}</li><!-- /wp:list-item --><!-- wp:list-item --><li>${thanks_step_3}</li><!-- /wp:list-item --></ol><!-- /wp:list -->
<!-- wp:buttons --><div class=\"wp-block-buttons\"><!-- wp:button --><div class=\"wp-block-button\"><a class=\"wp-block-button__link wp-element-button\" href=\"/\">${thanks_button}</a></div><!-- /wp:button --></div><!-- /wp:buttons -->"

# The theme's header navigation falls back to listing every page (the thank-you page included)
# when no navigation menu exists, so the site gets its own: Home and Get a Quote.
create_post_if_missing wp_navigation "primary-navigation" "Primary navigation" "<!-- wp:navigation-link {\"label\":\"${nav_home}\",\"url\":\"/\",\"kind\":\"custom\",\"isTopLevelLink\":true} /-->
<!-- wp:navigation-link {\"label\":\"${nav_quote}\",\"url\":\"/get-a-quote/\",\"kind\":\"custom\",\"isTopLevelLink\":true} /-->"

home_id=$(wp post list --post_type=page --name=home --field=ID)
wp option update show_on_front page
wp option update page_on_front "$home_id"

wp plugin activate moving-quote

# The secret and team email go through STDIN, never the command line (`ps`, shell history);
# `option patch update` doesn't echo a piped value.
wp option patch update moving_quote_settings webhook_url "http://n8n:5678/webhook/moving-quote/leads"
wp option patch update moving_quote_settings webhook_secret <<< "$LEAD_WEBHOOK_SECRET"
wp option patch update moving_quote_settings team_email <<< "$TEAM_EMAIL"

admin_url="${WP_URL%/}/wp-admin/"
echo "Site: $WP_URL"
echo "Admin: $admin_url"
