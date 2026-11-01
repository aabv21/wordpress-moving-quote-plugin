# Chivabox Movers: WordPress Moving-Quote Plugin

**Demo.** Fictional business, not client work.

A custom WordPress plugin that gives instant moving estimates, keeps every request safe in WordPress, and sends signed leads to n8n for the team sheet and emails.

## Status

The repository skeleton, the strict TypeScript toolchain, the PHP toolchain, and CI are in place. The plugin has its skeleton, its pricing engine, its install lifecycle (the leads table, default settings, and the outbox cron schedule), its admin settings page (rates, cities and distances, delivery), its public REST API (an estimate endpoint and a lead-submission endpoint with validation, rate limiting, and deduplication), the customer-facing three-step quote form with a TypeScript frontend bundled by esbuild, signed delivery of every saved lead to n8n, with an inline attempt right after the insert and a cron-driven outbox that retries a failed one with backoff, and an admin Leads page (filtering, paging, per-row status updates, a formula-injection-safe CSV export, retrying a failed delivery, and a stuck-delivery notice). The full local stack (WordPress, MySQL, Postgres, n8n) runs in Docker Compose, and `setup.sh` installs and configures WordPress and the delivery settings idempotently. The n8n workflows that receive the delivered lead are not built yet.

## What works now

- `npm run typecheck`, `npm run lint`, and `npm test` pass.
- `scripts/init-env.ts` builds `.env` from `.env.example`, filling only empty `_PASSWORD`, `_SECRET`, and `_KEY` values (skipping `GOOGLE_*`, which come from the owner's own OAuth client) with random hex, and refuses to overwrite an existing `.env`. The write is atomic: it writes a temp file at mode 0600, then renames it over `.env`, so an interrupted run never leaves a truncated file.
- `npm run php -- composer check` (PHPCS, PHPStan level 9, PHPUnit) and `npm run php -- composer audit` pass, inside a PHP 8.3 Docker image. PHPUnit runs 100 tests for `Pricing\Calculator`, `Pricing\DistanceTable`, `Settings\SettingsSanitizer`, `Leads\LeadValidator`, `Leads\LeadRecord`, the pure `Delivery` classes (`JwtSigner`, `LeadPayload`, `ResponseCheck`, `Backoff`, `SyncTransition`), and the pure `Admin\CsvEscaper` and `Admin\LeadCsv`, with no WordPress bootstrap.
- `Pricing\Calculator::estimate()` computes a moving estimate (amount, range, distance) from a move type, room count, origin, destination, and extras, against the default rates and routes in `Settings\Defaults`.
- `docker compose up -d --wait` brings up WordPress 7.1.4 on MySQL 8.4 (with a WP-CLI container and a cron sidecar) and n8n 2.45.6 on Postgres 17, all healthy.
- `./setup.sh` installs WordPress, sets the site description, timezone, and pretty permalinks, activates the default theme and the plugin, and creates the Home, Get a Quote, and Thank You pages. It's idempotent: running it again changes nothing.
- `npm run test:stack` drives the real stack over HTTP and WP-CLI: WordPress is installed and configured as expected, the plugin is active, the site pages respond, Postgres keeps the `app` and `n8n` databases isolated from each other's roles, and a lead's signed delivery (acceptance, a failure retried with backoff, a 3xx that's never followed, an unreachable or misconfigured webhook, and a poisoned row that doesn't block the rest of the batch) is verified against a local HTTP receiver standing in for n8n.
- Activating the plugin creates the leads table through `dbDelta`, seeds `moving_quote_settings` with the pricing defaults (without overwriting an existing value), sets `moving_quote_db_version`, and schedules the `moving_quote_process_outbox` hook on a 60-second `moving_quote_every_minute` schedule.
- Deactivating the plugin only clears the scheduled hook; the leads table and the settings stay. Reactivating restores the hook without touching either. A stored schema version older than the plugin's reruns `dbDelta` on the next page load.
- Uninstalling through WordPress (`wp plugin uninstall`, or deleting the plugin from the dashboard) drops the leads table, deletes both options, deletes the rate-limit transients, and clears the scheduled hook.
- The "Moving quotes" admin menu has a Settings page (rates, cities and distances, delivery) at Settings → Moving Quote Settings, gated to `manage_options`: an anonymous visitor is redirected to log in, and any other logged-in user gets a 403.
- Saving the settings form accepts Colombian-formatted amounts ("4.500", "4,500", "4500" all mean 4,500 COP), rejects an invalid amount, city, route, percentage, URL, secret, or email with a notice while keeping the last valid value, and never prints the webhook secret in the page HTML.
- `./setup.sh` also sets the webhook URL, the webhook secret (from `LEAD_WEBHOOK_SECRET`), and the team email (from `TEAM_EMAIL`), piped through STDIN so neither secret touches the command line.
- `POST /wp-json/moving-quote/v1/estimate` prices a move from the current settings with no nonce required, and is rate-limited to 120 requests per 10 minutes per IP.
- `POST /wp-json/moving-quote/v1/leads` requires a valid `X-WP-Nonce`, rejects a filled honeypot field by answering success without saving anything, validates every field (rooms 1–5, a known city pair, a move date from today through 12 months out in `America/Bogota`, name/phone/email limits, and required consent), prices the move itself (ignoring any price the client sent), and saves the lead. A resubmission with the same browser-minted `submission_id` is idempotent: it returns the already-saved lead instead of creating a second row, including under two identical requests sent at the same time. The `submit` rate limit (5 per hour per IP) is only spent by a lead that actually gets inserted, so correcting a validation error or double-tapping Submit never costs part of that budget.
- Once delivery is configured (webhook URL, secret, and team email all set), a newly inserted lead triggers an inline delivery attempt: the response is still 201 regardless of how that attempt goes. The signed request carries an HS256 JWT (`Authorization: Bearer …`, claims `jti`/`iat`/`exp`/`body_sha256`) over a JSON body matching the documented lead-payload contract exactly, and only a 2xx with JSON `status` `accepted` or `duplicate` counts as delivered.
- A failed attempt is stored `pending` with the error and a backoff-scheduled retry (`min(60 × 2^(n-1), 21600)` seconds, giving up as `failed` after 10 attempts); the `moving_quote_process_outbox` cron hook retries every currently due lead in batches of 20, each one claimed with a lease first so two overlapping runs don't normally deliver the same lead twice. Delivery is at-least-once, not exactly-once: n8n dedupes on the lead's `jti`. A row with data this plugin version can't parse is recorded as a failed attempt and skipped, without blocking the rest of the batch.
- The `[moving_quote]` shortcode on the Get a Quote page renders an accessible, three-step form (move details, extras, customer details) with a progress indicator, a honeypot, and a `<noscript>` fallback. Its script and style load only on a page that uses the shortcode.
- The form's TypeScript frontend (`src/frontend/`, bundled by esbuild into the committed `plugin/moving-quote/assets/quote-form.js`) debounces a live estimate as the visitor fills in step 1, moves focus to each new step's legend, and on submit disables the button and shows "Sending…" until the response arrives. A 2xx redirects to the Thank You page (or shows an inline success message if that page doesn't exist); a 422 shows the field errors and jumps back to the first step that has one; a 403, 429, or network failure shows the matching message and re-enables the button. Verified in a real browser at 390 px and 1280 px, with a full keyboard-only pass (Tab, Enter, and Space reach and operate every control) and no console errors.
- The "Moving quotes" admin page (`Admin\LeadsPage`, a `WP_List_Table` subclass) lists every lead with its reference, customer, move, route, estimate, lifecycle status, and delivery state, with a view per status (each with a live count), 20 per page, and a filter kept across paging and export. An admin updates a lead's status through a per-row form, and retries a `failed` delivery through a "Retry delivery" link that requeues it (`pending`, 0 attempts, due immediately) — never relabeled "sent", since the retry only requeues the lead. Every handler checks `manage_options` before its nonce, and a non-admin gets 403.
- "Export CSV" streams every matching lead as `text/csv` with a UTF-8 BOM, in batches of 500, with every cell passed through `Admin\CsvEscaper`: a value starting with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with `'` so it can never run as a spreadsheet formula when the file is opened.
- A warning notice on the Dashboard and the Leads page (`manage_options` only) reports how many leads haven't reached n8n — any `failed` lead, or one `pending` for over an hour — and links to the Leads page.
- CI runs quality (typecheck, lint, test, the frontend asset drift check, the PHP checks, an autoloader drift check), security (gitleaks, `npm audit`, `composer audit`), actions (actionlint, zizmor), and stack (bring up WordPress, run `setup.sh`, run the WordPress stack tests) checks on every pull request.

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
