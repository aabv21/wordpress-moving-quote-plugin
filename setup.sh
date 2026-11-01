#!/usr/bin/env bash
# Installs and configures WordPress for Chivabox Movers. Idempotent: safe to run again after the
# stack is already set up. Requires `docker compose up -d --wait` to have run first.
set -euo pipefail
cd "$(dirname "$0")"

# Read the settings from .env, so the script works from a fresh shell.
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

# `db` can report healthy before the real MySQL server is listening (its init phase runs a
# temporary server on a Unix socket only). Probe with a raw mysqli connection, bypassing
# WordPress entirely: the CLI image's external MariaDB client binary (what `wp db check` shells
# out to) rejects MySQL 8.4's self-signed TLS certificate, but WP-CLI's own PHP mysqli driver
# connects to it fine.
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

for name in WP_URL WP_ADMIN_USER WP_ADMIN_PASSWORD WP_ADMIN_EMAIL LEAD_WEBHOOK_SECRET TEAM_EMAIL; do
  if [ -z "${!name:-}" ]; then
    echo "setup.sh: ${name} is not set; run node scripts/init-env.ts and fill in .env first" >&2
    exit 1
  fi
done

if ! wp core is-installed >/dev/null 2>&1; then
  # `--prompt=admin_password` keeps the password off argv and out of the process list, reading it
  # from stdin instead. But WP-CLI's PHP build has readline() available, and reading a prompt's
  # answer from a non-tty pipe through readline() echoes that answer straight back to stdout, so
  # the whole call is redirected to /dev/null; stderr is left alone, and `set -e` still catches a
  # failure. Errors print to stderr either way, so this only hides WP-CLI's own progress notices.
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

wp option update blogdescription "Moving across Colombia's Caribbean coast"
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

create_page_if_missing() {
  slug="$1"
  title="$2"
  content="$3"
  existing=$(wp post list --post_type=page --name="$slug" --field=ID)
  if [ -z "$existing" ]; then
    wp post create --post_type=page --post_status=publish --post_title="$title" --post_name="$slug" --post_content="$content" >/dev/null
  fi
}

create_page_if_missing "home" "Home" '<!-- wp:heading --><h2>Moving made simple on Colombia'"'"'s Caribbean coast</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Chivabox Movers moves homes and offices between Barranquilla, Cartagena, Santa Marta, and the rest of the coast. Get an instant estimate in under a minute.</p><!-- /wp:paragraph -->
<!-- wp:buttons --><div class="wp-block-buttons"><!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/get-a-quote/">Get a quote</a></div><!-- /wp:button --></div><!-- /wp:buttons -->'

create_page_if_missing "get-a-quote" "Get a Quote" '<!-- wp:paragraph --><p>Tell us about your move and see an estimate right away.</p><!-- /wp:paragraph -->
<!-- wp:shortcode -->[moving_quote]<!-- /wp:shortcode -->'

create_page_if_missing "thank-you" "Thank You" "<!-- wp:paragraph --><p>Thank you! We received your request. A member of our team will call you to confirm the details and the final price. We'll also email you a summary.</p><!-- /wp:paragraph -->"

home_id=$(wp post list --post_type=page --name=home --field=ID)
wp option update show_on_front page
wp option update page_on_front "$home_id"

wp plugin activate moving-quote

admin_url="${WP_URL%/}/wp-admin/"
echo "Site: $WP_URL"
echo "Admin: $admin_url"
