# Chivabox Movers: WordPress Moving-Quote Plugin

**Demo.** Fictional business, not client work.

A custom WordPress plugin that gives instant moving estimates, keeps every request safe in WordPress, and sends signed leads to n8n for the team sheet and emails.

## Status

The repository skeleton, the strict TypeScript toolchain, the PHP toolchain, and CI are in place. The plugin has its skeleton, its pricing engine, its install lifecycle (the leads table, default settings, and the outbox cron schedule), and its admin settings page (rates, cities and distances, delivery). The full local stack (WordPress, MySQL, Postgres, n8n) runs in Docker Compose, and `setup.sh` installs and configures WordPress and the delivery settings idempotently. The quote form, the leads admin, and the n8n workflows are not built yet.

## What works now

- `npm run typecheck`, `npm run lint`, and `npm test` pass.
- `scripts/init-env.ts` builds `.env` from `.env.example`, filling only empty `_PASSWORD`, `_SECRET`, and `_KEY` values (skipping `GOOGLE_*`, which come from the owner's own OAuth client) with random hex, and refuses to overwrite an existing `.env`. The write is atomic: it writes a temp file at mode 0600, then renames it over `.env`, so an interrupted run never leaves a truncated file.
- `npm run php -- composer check` (PHPCS, PHPStan level 9, PHPUnit) and `npm run php -- composer audit` pass, inside a PHP 8.3 Docker image. PHPUnit runs 38 tests for `Pricing\Calculator`, `Pricing\DistanceTable`, and `Settings\SettingsSanitizer`, with no WordPress bootstrap.
- `Pricing\Calculator::estimate()` computes a moving estimate (amount, range, distance) from a move type, room count, origin, destination, and extras, against the default rates and routes in `Settings\Defaults`.
- `docker compose up -d --wait` brings up WordPress 7.1.4 on MySQL 8.4 (with a WP-CLI container and a cron sidecar) and n8n 2.45.6 on Postgres 17, all healthy.
- `./setup.sh` installs WordPress, sets the site description, timezone, and pretty permalinks, activates the default theme and the plugin, and creates the Home, Get a Quote, and Thank You pages. It's idempotent: running it again changes nothing.
- `npm run test:stack` drives the real stack over HTTP and WP-CLI: WordPress is installed and configured as expected, the plugin is active, the site pages respond, and Postgres keeps the `app` and `n8n` databases isolated from each other's roles.
- Activating the plugin creates the leads table through `dbDelta`, seeds `moving_quote_settings` with the pricing defaults (without overwriting an existing value), sets `moving_quote_db_version`, and schedules the `moving_quote_process_outbox` hook on a 60-second `moving_quote_every_minute` schedule.
- Deactivating the plugin only clears the scheduled hook; the leads table and the settings stay. Reactivating restores the hook without touching either. A stored schema version older than the plugin's reruns `dbDelta` on the next page load.
- Uninstalling through WordPress (`wp plugin uninstall`, or deleting the plugin from the dashboard) drops the leads table, deletes both options, deletes the rate-limit transients, and clears the scheduled hook.
- The "Moving quotes" admin menu has a Settings page (rates, cities and distances, delivery) at Settings → Moving Quote Settings, gated to `manage_options`: an anonymous visitor is redirected to log in, and any other logged-in user gets a 403.
- Saving the settings form accepts Colombian-formatted amounts ("4.500", "4,500", "4500" all mean 4,500 COP), rejects an invalid amount, city, route, percentage, URL, secret, or email with a notice while keeping the last valid value, and never prints the webhook secret in the page HTML.
- `./setup.sh` also sets the webhook URL, the webhook secret (from `LEAD_WEBHOOK_SECRET`), and the team email (from `TEAM_EMAIL`), piped through STDIN so neither secret touches the command line.
- CI runs quality (typecheck, lint, test, the PHP checks, an autoloader drift check), security (gitleaks, `npm audit`, `composer audit`), actions (actionlint, zizmor), and stack (bring up WordPress, run `setup.sh`, run the WordPress stack tests) checks on every pull request.

## Quick start

```sh
npm ci
node scripts/init-env.ts
cp config/config.example.json config/config.json
docker compose up -d --wait
./setup.sh
```

`node scripts/init-env.ts` writes `.env` from `.env.example`. Fill in `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` by hand; every other secret is generated.

Once the stack is up:

- WordPress: <http://localhost:8080>
- WordPress admin: <http://localhost:8080/wp-admin/> (`WP_ADMIN_USER`/`WP_ADMIN_PASSWORD` from `.env`)
- n8n: <http://localhost:5678>

PHP runs only inside Docker: there is no local `php` or `composer`. `npm run php -- <command>` runs `<command>` in the PHP tools container.

Only one of this series' demo stacks can run at a time: every demo binds `127.0.0.1:5678`, and this one also binds `127.0.0.1:8080`. Run `docker compose ls` first, and stop any other demo's stack before bringing this one up.
