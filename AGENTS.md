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
- `plugin/moving-quote/` — the WordPress plugin (PHP, namespace `Chivabox\MovingQuote`), with `moving-quote.php` (the main file), `uninstall.php`, `composer.json`, the committed `vendor/` (the generated Composer autoloader), `src/Pricing/`, `src/Settings/` (`Defaults` and `SettingsSanitizer` are pure; `Options` reads the stored option), `src/Install/` (the leads table schema and the install lifecycle; see "Install lifecycle" below), `src/Admin/` (the settings page; see "Settings" below), `src/Leads/` (the leads domain: `LeadStatus`, `SyncStatus`, the value objects, `LeadValidator`, `LeadRepository`; see "REST API" below), `src/Security/` (`RateLimiter`), and `src/Rest/` (`EstimateController`, `LeadController`, `Messages`).
- `compose.yaml` — the full local stack: `db` (MySQL), `wordpress`, `wpcli` (idle, for one-off commands), `cron` (the WP-Cron loop sidecar), `postgres`, `n8n`, and `php` (the tools image). See "The local stack" below.
- `db/schema.sql`, `db/init/01-app.sh` — the app Postgres database schema (table `processed_events`, for n8n idempotency) and the one-time role/database bootstrap script.
- `config/config.example.json` — the n8n runtime config template; a developer's own `config/config.json` is gitignored.
- `setup.sh` — installs and configures WordPress idempotently against the running stack. See "The local stack" below.
- `scripts/lib/docker.ts` — a small `docker compose` wrapper (`compose(args, input?)`) for TypeScript tooling.
- `vitest.stack.config.ts`, `tests/stack/` — the stack-test harness (`tests/stack/lib/stack.ts`, `tests/stack/global-setup.ts`) and tests (`tests/stack/wp/`, `tests/stack/n8n/`) that drive the real Compose stack over HTTP and WP-CLI. See "The local stack" below.

Planned, added in later tasks:

- More `plugin/moving-quote/src/` namespaces: `Delivery`. The leads list page joins `src/Admin/`. Inline delivery to n8n joins `Rest\LeadController`.
- `plugin/moving-quote/templates/`, `plugin/moving-quote/assets/` (generated frontend JS).
- `src/frontend/` — the three-step quote form, written in TypeScript and compiled into `plugin/moving-quote/assets/`.
- `src/nodes/` — Code-node sources for the n8n workflows.
- `workflows/` — the n8n workflow JSON, mounted read-only into n8n.
- `docs/architecture.md`, `docs/diagrams/` — how the system works, with diagrams.

## Commands

- `npm ci` — install dependencies from the lockfile.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — `eslint .`.
- `npm test` — `vitest run`.
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
- **Cron.** Hook `moving_quote_process_outbox`, on the `moving_quote_every_minute` schedule (60 seconds), added through the `cron_schedules` filter.

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

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit` — there is no build step.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo will be generated: the compiled frontend asset and Code-node `jsCode`.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- Local shell note: if `npm` is aliased to another package manager on your machine, run `command npm` to reach the real npm.
- PHP: every file starts with `declare(strict_types=1);`. Class files under `plugin/moving-quote/src/` hold only declarations, with no `ABSPATH` guard, so PHPUnit loads them without WordPress; files that run code when loaded (`moving-quote.php`) start with `defined( 'ABSPATH' ) || exit;`, and `uninstall.php` starts with `defined( 'WP_UNINSTALL_PLUGIN' ) || exit;`. Pure classes (`Pricing\*`, `Settings\Defaults`, `Leads\LeadValidator`, the `Leads` value objects, …) never call a WordPress function — `Rest\Messages::field()` is the one exception, since it needs `__()` for translated field messages. PHPStan runs at level 9 with typed array shapes (`@param array{…}`, `@return iterable<string, array{…}>`) on every helper and data provider that touches an array.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials — never in code, workflow JSON, or committed config. `scripts/init-env.ts` never prints a secret.
- Test data: emails use `example.com`; phone numbers use the prefix `5700000000`; customer names are invented. Everything in the repo is in English.
- Generated files (the compiled frontend asset, the Composer autoloader, each Code node's `jsCode`) are committed, and CI fails when they drift. Never edit them by hand. `plugin/moving-quote/vendor/` is regenerated with `npm run php -- composer autoload:plugin`; its `composer.json` pins an explicit `version` and `autoloader-suffix` so the generated files are identical across commits.
- Point tooling only at this repo's local n8n instance, never another instance. Validate workflows with an n8n-aware validation tool before importing them.
- **PR protocol.** Branch `task-NN-<slug>` from `main`. The implementer only commits; the controller pushes, opens the PR (summary, verification, review record), waits for green CI, then squash-merges.

## Definition of done

- `npm run typecheck && npm run lint && npm test` all pass locally — run this full gate before every commit that touches TypeScript.
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
