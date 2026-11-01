# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

This repo builds Chivabox Movers' moving-quote plugin: a WordPress plugin that gives instant moving estimates in a three-step form, saves every request in its own table, and delivers each lead to n8n as a signed request. In n8n the lead is recorded once, appended to a Google Sheet, and emailed to the team and the customer. It is a portfolio demo: every file should read as production-quality, not a prototype.

## Repo map

What exists today:

- `package.json`, `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts` — the TypeScript toolchain.
- `scripts/init-env.ts` — builds `.env` from `.env.example`, generating missing secrets and refusing to overwrite an existing file.
- `src/globals.d.ts` — declares the ambient Luxon `DateTime` global that n8n's Code-node sandbox provides. `tests/setup.ts` provides the same value at test time.
- `tests/` — Vitest tests, at `tests/**/*.test.ts`.
- `.env.example` — the environment variable template; a developer's own `.env` is gitignored.
- `.github/workflows/`, `.github/dependabot.yml` — CI (quality, security, actions jobs; CodeQL once the repo is public) and automated dependency updates.
- `docker/php/Dockerfile`, `compose.yaml` — the PHP tools image (PHP 8.3, Composer, PHPUnit, PHPStan, PHPCS), run only through `command npm run php -- …`. There is no local `php` or `composer`.
- `composer.json`, `composer.lock`, `phpcs.xml.dist`, `phpstan.neon.dist`, `phpunit.xml.dist` — the PHP tooling config at repo root.
- `tests/php/` — PHPUnit tests for the plugin's pure classes, at `tests/php/**/*Test.php`.
- `plugin/moving-quote/` — the WordPress plugin (PHP, namespace `Chivabox\MovingQuote`), with `moving-quote.php` (the main file), `uninstall.php`, `composer.json`, the committed `vendor/` (the generated Composer autoloader), `src/Pricing/`, `src/Settings/` (`Defaults` and `SettingsSanitizer` are pure; `Options` reads the stored option), `src/Install/` (the leads table schema and the install lifecycle; see "Install lifecycle" below), `src/Admin/` (the settings page; see "Settings" below), `src/Leads/` (the leads domain: `LeadStatus`, `SyncStatus`, the value objects, `LeadValidator`, `LeadRepository`; see "REST API" and "Delivery" below), `src/Security/` (`RateLimiter`), `src/Rest/` (`EstimateController`, `LeadController`, `Messages`), `src/Delivery/` (signing, payload, retries, and the outbox; see "Delivery" below), and `src/Frontend/` (`Shortcode`; see "The quote form" below).
- `plugin/moving-quote/templates/quote-form.php` — the `[moving_quote]` shortcode's markup, included by `Frontend\Shortcode::render()`.
- `plugin/moving-quote/assets/quote-form.css` — the quote form's stylesheet. `plugin/moving-quote/assets/quote-form.js` is generated; see "The quote form" below.
- `compose.yaml` — the full local stack: `db` (MySQL), `wordpress`, `wpcli` (idle, for one-off commands), `cron` (the WP-Cron loop sidecar), `postgres`, `n8n`, and `php` (the tools image). See "The local stack" below.
- `db/schema.sql`, `db/init/01-app.sh` — the app Postgres database schema (table `processed_events`, for n8n idempotency) and the one-time role/database bootstrap script.
- `config/config.example.json` — the n8n runtime config template; a developer's own `config/config.json` is gitignored.
- `setup.sh` — installs and configures WordPress idempotently against the running stack. See "The local stack" below.
- `scripts/lib/docker.ts` — a small `docker compose` wrapper (`compose(args, input?)`) for TypeScript tooling.
- `scripts/build-assets.ts` — bundles the frontend into the committed `plugin/moving-quote/assets/quote-form.js`; see "The quote form" below.
- `src/frontend/` — the three-step quote form's TypeScript source: `quote-form.ts` (orchestration) and `lib/` (`debounce`, `latest`, `uuid`, `api`, `form-state` — small, independently tested modules). Type-checked under its own `src/frontend/tsconfig.json` (DOM lib) in addition to the root, Node-targeted one. See "The quote form" below.
- `tests/fixtures/lead-payload.json` — the exact contract body `Delivery\LeadPayload::body()` produces for one fixed lead, read by `tests/php/Delivery/LeadPayloadTest.php`. See "Delivery" below.
- `vitest.stack.config.ts`, `tests/stack/` — the stack-test harness (`tests/stack/lib/stack.ts`, `tests/stack/lib/leads.ts`, `tests/stack/lib/receiver.ts`, `tests/stack/lib/jwt.ts`, `tests/stack/global-setup.ts`) and tests (`tests/stack/wp/`, `tests/stack/n8n/`) that drive the real Compose stack over HTTP and WP-CLI. See "The local stack" and "Delivery" below.
- `tests/frontend/` — Vitest unit tests for `src/frontend/lib/*`, at `tests/frontend/*.test.ts`.

Planned, added in later tasks:

- The leads list page joins `src/Admin/`.
- `src/nodes/` — Code-node sources for the n8n workflows.
- `workflows/` — the n8n workflow JSON, mounted read-only into n8n.
- `docs/architecture.md`, `docs/diagrams/` — how the system works, with diagrams.

## Commands

- `npm ci` — install dependencies from the lockfile.
- `npm run typecheck` — `tsc --noEmit`, then `tsc --noEmit -p src/frontend/tsconfig.json` (the frontend's own DOM-lib tsconfig).
- `npm run lint` — `eslint .`.
- `npm test` — `vitest run`.
- `npm run build:assets` — bundles `src/frontend/quote-form.ts` with esbuild into the committed `plugin/moving-quote/assets/quote-form.js` (minified IIFE, target `es2020`, no runtime dependencies). `-- --check` builds in memory and exits 1 if the result differs from the committed file, without writing anything; CI runs this. Never edit `quote-form.js` by hand — run this command and commit the result instead.
- `node scripts/init-env.ts` — writes `.env` from `.env.example`, filling empty `_PASSWORD`, `_SECRET`, and `_KEY` values with random hex (skipping `GOOGLE_*`, which come from the owner's own OAuth client). Refuses to run if `.env` already exists.
- `npm run php -- composer <script>` — runs a root `composer.json` script inside the PHP tools container (`profiles: [tools]`, no published ports). PHP runs only this way: there is no local `php` or `composer`.
  - `composer lint` — PHPCS (WPCS + PHPCompatibilityWP) over `plugin/moving-quote`.
  - `composer analyse` — PHPStan level 9 over the plugin source and `tests/php`.
  - `composer test` — PHPUnit over `tests/php`, no WordPress bootstrap.
  - `composer check` — lint, then analyse, then test.
  - `composer autoload:plugin` — regenerates `plugin/moving-quote/vendor/`, the plugin's committed Composer autoloader. CI fails if this changes anything (`git diff --exit-code -- plugin/moving-quote/vendor`); run it and commit the result whenever the plugin's PSR-4 mapping changes.
- `docker compose ls` — list running Compose stacks; run this before starting the stack (see "The local stack" below).
- `docker compose up -d --wait` — start every service and wait for all of them to report healthy.
- `./setup.sh` — install and configure WordPress against the running stack. Idempotent; see "The local stack" below.
- `docker compose down` — stop the stack. Add `-v` to also drop the named volumes (destructive: wipes WordPress, MySQL, Postgres, and n8n's data).
- `npm run test:stack` — the full stack suite (`tests/stack/**`) against `vitest.stack.config.ts`: needs the whole stack (MySQL, WordPress, WP-CLI, Postgres, n8n) healthy and `./setup.sh` already run.
- `npm run test:stack:wp` — only `tests/stack/wp/`, the subset that needs just MySQL, WordPress, and WP-CLI. This is what CI's `stack` job runs on every PR.

## The local stack

- **Services and ports.** `docker compose up -d --wait` brings up `db` (MySQL 8.4, unpublished), `wordpress` (on `127.0.0.1:8080`), `wpcli` (idle, for one-off `wp` commands), `cron` (runs `wp cron event run --due-now` every 60 s, since WP-Cron itself is disabled), `postgres` (unpublished), and `n8n` (on `127.0.0.1:5678`).
- **One stack at a time.** Every demo in this series binds `127.0.0.1:5678`, and this one also binds `127.0.0.1:8080`. Run `docker compose ls` first, and stop any other demo's stack before bringing this one up — otherwise `up` fails on the port conflict, or a test ends up talking to the wrong n8n.
- **`setup.sh`** requires `docker compose up -d --wait` to have already run. It waits for MySQL to actually accept TCP connections (its health status can turn healthy before the real server does), then installs WordPress (admin password read from `.env` over stdin, never as an argument), sets the site description, timezone, and pretty permalinks, activates the default theme and the `moving-quote` plugin, creates the `home`, `get-a-quote`, and `thank-you` pages, and sets the delivery settings: `webhook_url` to the in-network n8n address, and `webhook_secret`/`team_email` from `.env`'s `LEAD_WEBHOOK_SECRET`/`TEAM_EMAIL`, both piped through STDIN so neither touches the command line. It's idempotent: running it again touches nothing that's already correct.
- **Stack tests never use `wp db query`.** The `wpcli` image's bundled MariaDB client isn't guaranteed compatible with MySQL 8.4's wire protocol. `tests/stack/lib/stack.ts`'s `sqlWp()` instead runs `wp eval-file -`, which executes PHP through WordPress's own `$wpdb`, the same client the plugin itself uses at runtime.

## Install lifecycle

- **Activate** (`Install\Installer::activate()`) creates the leads table through `dbDelta` (`Install\Schema::sql()`), seeds `moving_quote_settings` with the pricing defaults without overwriting an existing value, sets `moving_quote_db_version`, and schedules the outbox cron hook.
- **Deactivate** only clears the scheduled hook. The leads table and both options stay: deactivating is not the same as uninstalling.
- **Upgrade** (`Install\Installer::maybe_upgrade()`) runs on every `plugins_loaded`. When the stored `moving_quote_db_version` differs from the plugin's, it reruns `dbDelta` and updates the version, so an existing site picks up a schema change on its next request.
- **Uninstall** (`plugin/moving-quote/uninstall.php`, run only by WordPress when the plugin is deleted) drops the leads table, deletes both options, deletes the rate-limit transients, and clears the scheduled hook. This is the one path that removes data.
- **Cron.** Hook `moving_quote_process_outbox`, on the `moving_quote_every_minute` schedule (60 seconds), added through the `cron_schedules` filter. `Plugin::boot()` wires the hook itself to `Delivery\Outbox::process_due()`; see "Delivery" below.

## Settings

- **Admin page.** `Admin\Menu::register()` adds the "Moving quotes" top-level menu (capability `manage_options`, icon `dashicons-car`) and its Settings submenu, rendered by `Admin\SettingsPage::render()` as three sections: rates, cities and distances (existing routes, three blank rows, a remove checkbox, and a warning listing any missing city pair), and delivery.
- **Sanitizing a save.** `Admin\SettingsPage::sanitize()` applies a field-appropriate WordPress sanitizer — `esc_url_raw()` for the webhook URL, `trim()` only for the secret and the team email (never `sanitize_text_field()` or `sanitize_email()`, both of which can silently turn an invalid or tricky value into an empty string before the real validation ever sees it) — then hands the result to the pure `Settings\SettingsSanitizer`, which keeps a field's current value and reports an error code on any invalid input. `options.php` already unslashes the posted value, so this never unslashes a second time.
- **The webhook secret.** Submitting the form with the secret field left blank keeps the currently stored secret; only a non-blank value (at least 32 characters) replaces it. The rendered field is always `type="password"` with an empty value, so the page's HTML never contains the stored secret.
- **Delivery gating.** `Settings\Options::delivery_enabled()` is true only once the webhook URL, the webhook secret, and the team email are all non-empty; the settings page shows "Delivery is on" or "Delivery is off until the webhook URL, secret, and team email are set." accordingly.
- **`setup.sh`'s delivery keys.** It sets `webhook_url` to the in-network n8n address, and patches `webhook_secret`/`team_email` from `.env`'s `LEAD_WEBHOOK_SECRET`/`TEAM_EMAIL` through `wp option patch update …`, both piped over STDIN.

## REST API

- **`POST /wp-json/moving-quote/v1/estimate`** (`Rest\EstimateController`). No nonce. Rate limit: `estimate` bucket, 120 per 600 s. Validates and prices with `Leads\LeadValidator::quote()` and `Pricing\Calculator`, against the current settings. Responses: 200 with the estimate; 422 `moving_quote_invalid` (`data.errors`, field to message); 429 `moving_quote_rate_limited` with a `Retry-After` header.
- **`POST /wp-json/moving-quote/v1/leads`** (`Rest\LeadController`). Requires `X-WP-Nonce` (action `wp_rest`). In order: nonce check, honeypot (`website`), validation (`Leads\LeadValidator::lead()`), pricing, a duplicate lookup by `submission_id` (= `request_uuid`), the `submit` rate limit, then the insert.
  - **The `submit` rate limit (5 per 3,600 s) is counted only once a lead is about to be inserted** — after the honeypot, validation, and the duplicate lookup all pass. A customer correcting a typo, or double-tapping Submit, never burns through the limit on an attempt that was never going to save anything; only a genuinely new lead counts.
  - **Both routes register with no `args` schema.** A restrictive schema would make core answer its own 400 `rest_invalid_param` before the route runs, preempting the 422 contract. Every field is validated by `LeadValidator` instead.
  - **The nonce has two error codes.** A missing `X-WP-Nonce` header gets the plugin's own 403 `moving_quote_bad_nonce`. A stale or forged nonce never reaches the plugin at all: WordPress core's `rest_cookie_check_errors` rejects it first, with 403 `rest_cookie_invalid_nonce` ("Cookie check failed"). The estimate route sends no nonce and must never receive one from the frontend.
  - Responses: 201 `{"ok":true,"reference":"MQ-…","estimate":{…}}` for a new lead; 200 with the same shape for a duplicate `submission_id` (nothing is saved or counted against the limit again); 201 `{"ok":true}` for a filled honeypot (nothing saved); 422 `moving_quote_invalid`; 429 `moving_quote_rate_limited`; 500 `moving_quote_save_failed` for any other insert failure (logged without PII).
- **`Security\RateLimiter`** stores fixed-window counts in transients keyed `moving_quote_rl_{bucket}_{hash}`, hashed from the client IP so the IP itself never appears in the database. `client_ip()` reads `REMOTE_ADDR`, filterable through `moving_quote_client_ip`.

## Delivery

Every saved lead is sent to n8n as a signed, authenticated HTTP request: once right after the insert, and from then on through a cron-driven outbox that retries a failed attempt with backoff.

- **Signing and payload.** `Delivery\JwtSigner::hs256()` signs a claims array into a compact HS256 JWT (base64url without padding). `Delivery\LeadPayload::body()` builds the exact JSON contract body (`JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR`, `submitted_at` as `created_at` converted to `America/Bogota` and formatted with `DATE_ATOM`); `tests/fixtures/lead-payload.json` holds that exact body for one fixed lead, shared between `tests/php/Delivery/LeadPayloadTest.php` and the global contract documentation. `LeadPayload::claims()` derives the JWT claims (`jti` = `request_uuid`, `iat`, `exp` = `iat + 300`, `body_sha256`) from the already-built body, so the signature binds to the exact bytes sent.
- **Response checks and retries.** `Delivery\ResponseCheck::acknowledged()` is the one place that decides whether n8n's response counts as delivered: a 2xx whose JSON `status` is `accepted` or `duplicate`. `Delivery\Backoff::delay_after()` is the retry schedule: `min(60 × 2^(n-1), 21600)` seconds after the n-th failure, giving up after `MAX_ATTEMPTS` (10). `Delivery\SyncTransition::after_attempt()` turns one attempt's outcome into a `Delivery\SyncUpdate` (the next `sync_status`, attempt count, `next_attempt_at`, `last_error` cut to 500 characters with `mb_substr`, and `sent_at`), with no WordPress or database dependency — every case in the backoff and status-transition table is covered by an exact PHPUnit case, not a range check.
- **`Delivery\WebhookClient::send()`** is the one place that calls `wp_remote_post()` (not `wp_safe_remote_post()`: the admin sets the URL themselves, and it is a private Docker hostname the safe variant's SSRF guard would otherwise block), with a 5 s timeout and no redirects. It returns null on an acknowledged 2xx, otherwise the error text: a `WP_Error`'s message, `HTTP {code}: {excerpt}` for a non-2xx, or `Unexpected response (HTTP {code}): {excerpt}` for an unacknowledged 2xx.
- **`Delivery\Outbox`** ties it together. Delivery is at-least-once, not exactly-once: n8n dedupes on `jti` (= `request_uuid`), and `apply_sync()`'s `pending` guard keeps an already-`sent` row `sent`. `deliver( LeadRecord $lead )` builds the payload body, the JWT claims, and the signed JWT itself, sends the request, and stores the resulting `SyncUpdate` through `LeadRepository::apply_sync()` — it does not claim the row itself. `process_due()` is the cron entry point and the one caller that does claim: it returns 0 without querying when `Options::delivery_enabled()` is false, otherwise it loads up to `BATCH_SIZE` (20) due rows through `LeadRepository::due()`, calls `LeadRepository::claim()` on each one with a lease counted from the moment of that call (not from when the batch started, so a slow batch never claims a later row with an already-stale lease), and calls `deliver()` only on the rows it actually claims. `LeadController`'s inline attempt (below) calls `deliver()` directly with no claim of its own, since `insert()` already set that row's `next_attempt_at = now + LEASE_SECONDS`, so no cron run can see it as due until that lease expires. A row whose `status` column `LeadRecord::from_row()` can't parse (`LeadStatus::from()` throwing `ValueError`, most likely written by a different plugin version) is recorded as a failed attempt using its own stored `attempts` and skipped, instead of losing the rest of the batch behind it.
  - **Every internal failure still counts as an attempt.** A `Throwable` caught anywhere in the delivery path goes through the same `SyncTransition::after_attempt()` call a genuine HTTP failure would, with `last_error` `Internal error: {class}` — never the exception's message, which could carry PII pulled from the lead. This is what makes a persistent internal fault back off and eventually reach `failed` instead of retrying every lease window forever, and it is never logged separately.
  - **Two lifecycle writes are guarded against a stale worker.** `LeadRepository::claim( $id, $expected_next_attempt_at, $lease_until )` is an `UPDATE` matched on `id`, the row's current `next_attempt_at`, and `sync_status = 'pending'`; it returns true only when exactly one row changed. `LeadRepository::apply_sync()` writes only while `sync_status = 'pending'`, so a worker holding a stale lease can never overwrite a row a faster, overlapping run already marked `sent`.
    - NOTE: a runner stalled past its own lease can still be overtaken by a second runner, which claims and delivers the row; if that second runner then fails and the row goes back to `pending`, the first runner's own late write can still land and mask the second runner's outcome, since `apply_sync()` only checks `sync_status`, not which lease issued the write. Fencing `apply_sync()` on the lease value `claim()` issued, not just on `sync_status = 'pending'`, would close that gap.
  - **`LeadController`'s inline attempt** runs `Outbox::deliver()` inside a try/catch, only after a *new* insert (never for a duplicate `submission_id` that found an existing row) and only when `Options::delivery_enabled()`. The response is 201 regardless of the delivery outcome, so the customer never sees an error the outbox's own retries will resolve on their own; this can still delay that 201 by up to `WebhookClient`'s 5 s timeout.
- **Stack-test helpers.** `tests/stack/lib/receiver.ts`'s `startReceiver()` is a tiny HTTP server standing in for n8n's webhook, listening on `0.0.0.0` on an ephemeral port at `http://host.docker.internal:<port>/lead` (every container in `compose.yaml` declares that host through `extra_hosts`, so it's reachable from WordPress, wpcli, and the cron sidecar, on Linux CI too). `tests/stack/lib/jwt.ts`'s `signHs256()` and `decodeVerified()` sign and verify an HS256 JWT with `node:crypto`; `decodeVerified()` uses a constant-time signature comparison and is asserted with `not.toBeNull()`, never by comparing a secret. `tests/stack/lib/leads.ts` tracks every `request_uuid` a test mints through `validLead()` and exposes `deleteCreatedLeads()` to sweep them: a saved lead is a real delivery attempt, and cron keeps retrying a pending one for hours, so every stack file that creates leads calls `deleteCreatedLeads()` in `afterAll`. `tests/stack/lib/stack.ts`'s `disableDelivery()` patches `webhook_url` to `''` and returns a restore function, for a file whose leads must never actually reach the configured n8n URL.
- **Keeping `tests/stack/wp/delivery.test.ts` deterministic.** `tests/stack/global-setup.ts` already stops the `cron` sidecar for the whole stack-test run (restarting it afterward only if it was running), so its background `wp cron event run --due-now` loop doesn't race this file's assertions in practice. The file still parks every other pending row (`next_attempt_at` far in the future) before each case and again afterward, and filters the receiver's recorded requests by the body's `request_uuid` rather than assuming "the last request" is its own, as a second layer of defense: both are cheap, and they keep the file correct even if that sidecar is ever running during a manual or partial run.

## The quote form

- **Shortcode.** `[moving_quote]` (`Frontend\Shortcode::TAG`), with one optional attribute, `thank_you` (the slug of the page to redirect to on success; defaults to `thank-you`). `Shortcode::register_assets()` registers the script (footer, `strategy: 'defer'`) and style on `init`; `Shortcode::render()` enqueues both, so they load only on a page that actually uses the shortcode.
- **Markup** (`templates/quote-form.php`). A `<form data-moving-quote data-config="…">` with three `<fieldset>`s (move details, extras, customer details), a progress `<ol>`, a honeypot (`name="website"`, visually and from Tab order, but still present for a screen reader and for any bot that fills every field by DOM access instead of tabbing), and a `<noscript>` fallback. Move type, rooms (1–5, "5+"), and both city selects are rendered server-side from `Pricing\MoveType` and `DistanceTable::cities()`; each city select starts with a disabled "Choose a city" placeholder. `data-config` is `wp_json_encode()` run through `esc_attr()`, so a city name or any other merchant-editable string can never break out of the attribute.
- **Frontend** (`src/frontend/quote-form.ts`, plus `src/frontend/lib/{debounce,latest,uuid,api,form-state}.ts`, each independently unit-tested). One `submission_id` (a browser-minted UUID v4) per page load, reused on every retry. The estimate call runs through `debounce(latestOnly(...), 300)`: a burst of edits collapses to one request 300 ms after the last one, and a response for input that's since been superseded is discarded instead of overwriting a newer result. Moving between steps shifts focus to the new step's `<legend>`. Submitting disables the button and shows "Sending…"; a 2xx redirects to the thank-you page (or shows an inline success message when that page doesn't exist); a 422 shows the field errors and jumps back to the first step with one; a 403 (either `moving_quote_bad_nonce` or core's `rest_cookie_invalid_nonce`), a 429, or a network failure shows the matching message and re-enables the button. No path shows success, or leaves the button disabled, on anything but a genuine 2xx.
- **The generated asset.** `plugin/moving-quote/assets/quote-form.js` is built by `npm run build:assets` (`scripts/build-assets.ts`, esbuild) and committed; CI fails the build if it drifts from the source (`build:assets -- --check`). Never edit it by hand — change `src/frontend/**` and rebuild.

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit` — there is no build step.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo is generated: the compiled frontend asset (`plugin/moving-quote/assets/quote-form.js`) and, in a later task, each Code node's `jsCode`.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- Local shell note: if `npm` is aliased to another package manager on your machine, run `command npm` to reach the real npm.
- PHP: every file starts with `declare(strict_types=1);`. Class files under `plugin/moving-quote/src/` hold only declarations, with no `ABSPATH` guard, so PHPUnit loads them without WordPress; files that run code when loaded (`moving-quote.php`, `templates/quote-form.php`) start with `defined( 'ABSPATH' ) || exit;`, and `uninstall.php` starts with `defined( 'WP_UNINSTALL_PLUGIN' ) || exit;`. Pure classes (`Pricing\*`, `Settings\Defaults`, `Leads\LeadValidator`, the `Leads` value objects, …) never call a WordPress function — `Rest\Messages::field()` is the one exception, since it needs `__()` for translated field messages. `Frontend\Shortcode` and `templates/quote-form.php` are WordPress-coupled by design (rendering and enqueuing can't be pure), so they're covered by the stack suite instead of PHPUnit. PHPStan runs at level 9 with typed array shapes (`@param array{…}`, `@return iterable<string, array{…}>`) on every helper and data provider that touches an array.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials — never in code, workflow JSON, or committed config. `scripts/init-env.ts` never prints a secret.
- Test data: emails use `example.com`; phone numbers use the prefix `5700000000`; customer names are invented. Everything in the repo is in English.
- Generated files (`plugin/moving-quote/assets/quote-form.js`, the Composer autoloader, each Code node's `jsCode`) are committed, and CI fails when they drift. Never edit them by hand. `quote-form.js` is regenerated with `npm run build:assets`; `plugin/moving-quote/vendor/` is regenerated with `npm run php -- composer autoload:plugin`; its `composer.json` pins an explicit `version` and `autoloader-suffix` so the generated files are identical across commits.
- Point tooling only at this repo's local n8n instance, never another instance. Validate workflows with an n8n-aware validation tool before importing them.
- **PR protocol.** Branch `task-NN-<slug>` from `main`. The implementer only commits; the controller pushes, opens the PR (summary, verification, review record), waits for green CI, then squash-merges.

## Definition of done

- `npm run typecheck && npm run lint && npm test` all pass locally — run this full gate before every commit that touches TypeScript. Also run `npm run build:assets -- --check` (and commit a fresh `npm run build:assets` if it fails) before every commit that touches `src/frontend/**`.
- `npm run php -- composer check && npm run php -- composer audit` pass locally — run this full gate before every commit that touches PHP.
- `npm run test:stack` passes locally against a running stack — run this before every commit that touches `compose.yaml`, `setup.sh`, or `tests/stack/**`.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits, on a branch named `task-NN-<slug>`.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and the `5700000000` phone prefix; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches its task's brief — nothing extra, nothing missing.
