# AGENTS.md

Guidance for anyone — human or AI — working in this repository.

## Purpose

This repo builds Chivabox Movers' moving-quote plugin: a WordPress plugin that gives instant moving estimates in a three-step form, saves every request in its own table, and delivers each lead to n8n as a signed request. In n8n the lead is recorded once, appended to a Google Sheet, and emailed to the team and the customer. It is a portfolio demo: every file should read as production-quality, not a prototype.

## Repo map

What exists today:

- `package.json`, `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts` — the TypeScript toolchain.
- `.env.example` — the environment template; a developer's own `.env` is gitignored.
- `.github/workflows/`, `.github/dependabot.yml` — CI (quality, security, actions, and stack jobs; CodeQL once the repo is public) and dependency updates.
- `docker/php/Dockerfile`, `compose.yaml` — the PHP tools image (PHP 8.3, Composer, PHPUnit, PHPStan, PHPCS), run only through `pnpm run php …`; there is no local `php` or `composer`.
- `composer.json`, `composer.lock`, `phpcs.xml.dist`, `phpstan.neon.dist`, `phpunit.xml.dist` — the PHP tooling config.
- `plugin/moving-quote/` — the WordPress plugin (namespace `Chivabox\MovingQuote`): `moving-quote.php`, `uninstall.php`, `composer.json`, and the committed `vendor/` autoloader. `src/` holds `Pricing/`, `Settings/` (`Defaults` and `SettingsSanitizer` are pure; `Options` reads the option), `Install/`, `Admin/`, `Leads/` (`LeadStatus`, `SyncStatus`, value objects, `LeadValidator`, `LeadRepository`), `Security/` (`RateLimiter`, `RateLimits`), `Rest/` (`EstimateController`, `LeadController`, `Messages`), `Delivery/`, and `Frontend/` (`Shortcode`, `ReferenceShortcode`); each has a section below.
- `plugin/moving-quote/templates/quote-form.php` — the `[moving_quote]` markup, included by `Frontend\Shortcode::render()`.
- `plugin/moving-quote/assets/quote-form.css` — the form's stylesheet, on its own `--mq-*` tokens. `quote-form.js` beside it is generated.
- `plugin/moving-quote/languages/` — text domain `moving-quote`: the generated `moving-quote.pot`, the hand-written `moving-quote-es_CO.po`, and its generated `.mo` and `.l10n.php`. See "Translations".
- `src/frontend/` — the form's TypeScript: `quote-form.ts` (orchestration) and `lib/` (`debounce`, `latest`, `uuid`, `api`, `form-state`, `estimate-display`, `estimate-fetch`, `reference`), each unit-tested. Also type-checked under its own DOM-lib `src/frontend/tsconfig.json`.
- `src/nodes/` — Code-node sources: `lead.ts` (`parseLead`, the payload contract), `locale.ts` (`normalizeLocale`, `parseTeamLocale`), `verify-request.ts` (`lead-intake`), and `map-lead.ts` (`process-lead`). `src/globals.d.ts` declares the sandbox's ambient Luxon `DateTime`, which `tests/setup.ts` provides in tests.
- `workflows/` — the three published workflows: `lead-intake.json` (`cvbLeadIntake001`), `process-lead.json` (`cvbProcessLead01`), and `error-handler.json` (`cvbErrorHandler1`), mounted read-only into n8n.
- `scripts/lib/manifest.ts` — the source of truth for fixed IDs: `WORKFLOWS` (all three), `CREDENTIALS`, `CODE_NODES` (`Verify request`, `Map lead`), `ERROR_WORKFLOW_ID`, and the pure `googleCredentialIds(credentials)`. `cvbCredGmail0001` is scoped to `gmail.send` alone; see "Security" in `docs/architecture.md`.
- `scripts/lib/` — also the workflow types, `normalizeWorkflow`, `listJsonFiles`, the Compose and `.env` helpers (`compose.ts`, plus the small `docker.ts` wrapper), the `/healthz` and webhook polls (`health.ts`), the shared `psql` helpers (`runtime.ts`: `runPsql`, `redact`, `secretValues`), and `gettext.ts` (the `.po` parser and `.pot` comparison).
- `scripts/` — the CLIs: `init-env.ts`, `build-assets.ts`, `build-workflows.ts`, `check-workflows.ts`, `export-workflows.ts`, `import-workflows.ts`, `setup-credentials.ts`, `setup.ts`, `db-migrate.ts`, `check-db.ts`, and `i18n.ts`. See Commands.
- `compose.yaml` — the stack: `db` (MySQL), `wordpress`, `wpcli`, `cron`, `postgres`, `n8n`, and `php`. `compose.queue.yaml` adds Redis and `n8n-worker` for queue mode.
- `db/schema.sql`, `db/init/01-app.sh` — the Postgres baseline (`processed_events`) and role bootstrap, run only on an empty volume. `db/migrations/` holds every later change (`001_runtime_role.sql`, `002_source_check.sql`); see `docs/database.md`.
- `config/config.example.json` — the n8n runtime config template (`google.leads_sheet_id`, `google.leads_tab`, `alerts.error_email`, `team_locale`). A developer's own `config/config.json` is gitignored; CI's `stack` job copies the example, which is enough because the chain never reaches Google there.
- `setup.sh` — installs and configures WordPress against the running stack. See "The local stack".
- `.n8n-import/` — a live bind mount created by `node scripts/init-env.ts`, used only for `pnpm run export`'s output (`.n8n-import/export`); never `rm -rf` it. No credential data crosses it. On Linux it works only when the host uid matches n8n's (1000).
- `playground/blueprint.json`, `blueprint.local.json`, `blueprint.es.json` — WordPress Playground blueprints. See "Trying the plugin in Playground".
- `tests/` — Vitest at `tests/**/*.test.ts` (`frontend/`, `nodes/`, `tooling/`, `scripts/`, `workflows.test.ts`, …), PHPUnit at `tests/php/**/*Test.php`, the stack suite in `tests/stack/` (`vitest.stack.config.ts`), and fixtures in `tests/fixtures/` (the lead payload and its 10 edge-case siblings, the hygiene-check workflows, a one-line Code-node source). `tests/lib/code-node.ts` runs `jsCode` the way n8n's Task Runner does. `docs/testing.md` covers every suite.
- `docs/` — see the Documentation map. `docs/screenshots/` holds the form, the thank-you page, and the Leads admin at 1280 px and 390 px; retake them whenever the markup or stylesheet changes.

## Documentation map

| Document | Covers |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Components, the workflows node by node, verified n8n 2.45.6 publishing and version behavior, the data model, failure modes (with recovery steps), scaling limits, security (including the exact token-retention mechanism and the trusted-proxy example), and the design decisions behind each part. |
| [`docs/database.md`](docs/database.md) | The Postgres `app_runtime` role and its exact grant (DML-only, no DDL, no `n8n` access), migrations (`db/migrations/`, applied by `pnpm run db:migrate`), retention on both Postgres and MySQL, backup and restore for both databases, connections, the credential-refresh upgrade path, and what `node scripts/check-db.ts` proves. The MySQL side is documented, not changed. |
| [`docs/testing.md`](docs/testing.md) | Every test suite: its command, what it covers, and how it stays deterministic and clean, plus what CI actually runs, the Playground observations, and the two deferred live checks. |
| [`docs/diagrams/architecture.json`](docs/diagrams/architecture.json) | The system diagram's archify typed source (type `architecture`): browser → WordPress (REST, leads table, cron sidecar) → n8n (`lead-intake`, `process-lead`, `error-handler`) → Postgres, Sheets, Gmail. |
| [`docs/diagrams/architecture.html`](docs/diagrams/architecture.html) | The system diagram's interactive page, rendered by archify. Open it directly to read the diagram full-size, pan, and inspect each node. |
| [`docs/diagrams/architecture.svg`](docs/diagrams/architecture.svg) | The system diagram's exported image (`SVG · Auto`, follows the reader's light or dark theme), embedded in `docs/architecture.md` and the README. |
| [`docs/diagrams/lead-sequence.json`](docs/diagrams/lead-sequence.json) | The lead-delivery sequence diagram's archify typed source (type `sequence`): form → estimate → submit → insert → signed POST → verify → record → respond → `process-lead`, with the retry loop as an alternative path. |
| [`docs/diagrams/lead-sequence.html`](docs/diagrams/lead-sequence.html) | The sequence diagram's interactive page. |
| [`docs/diagrams/lead-sequence.svg`](docs/diagrams/lead-sequence.svg) | The sequence diagram's exported image, embedded in `docs/architecture.md`. |

`docs/diagrams/*.delivery.json` receipts (one per diagram, written by `archify deliver`) hold local absolute paths and are gitignored; never force-add one.

## Commands

- `pnpm install --frozen-lockfile` — install dependencies from the lockfile.
- `pnpm run typecheck` — `tsc --noEmit` for the root config, then for `src/frontend/tsconfig.json`.
- `pnpm run lint` — `eslint .`.
- `pnpm test` — `vitest run`.
- `pnpm run build:assets` — bundles `src/frontend/quote-form.ts` with esbuild into the committed `plugin/moving-quote/assets/quote-form.js` (minified IIFE, `es2020`, no runtime dependencies). `-- --check` writes nothing and exits 1 on drift; CI runs it.
- `pnpm run build:workflows` — bundles each `src/nodes/*.ts` into its node's `jsCode` and sets `notes` to `Why Code: <why>`. `-- --check` exits 1 on drift without writing; CI runs it.
- `pnpm run check` — hygiene checks on `workflows/`: pinned data, `meta.instanceId`, required settings (`errorWorkflow: cvbErrorHandler1` everywhere but `error-handler`), literal emails, phones, long ids, or secrets, unknown credential ids, hand-written or undocumented Code nodes, missing retries on external-service nodes, a Postgres query built from an expression or with `$n` inside a SQL comment, and a missing sticky note. `node scripts/check-workflows.ts <dir>` checks any directory.
- `pnpm run i18n` — regenerates the `.pot` (`wp i18n make-pot`) and compiles every `.po` to `.mo` and `.l10n.php`, inside the running `wpcli` container with nothing downloaded. `-- --check` writes nothing and exits 1 on drift, ignoring the `.pot`'s `POT-Creation-Date`; CI's `stack` job runs it.
- `node scripts/init-env.ts` — writes `.env` from `.env.example`, filling empty `_PASSWORD`, `_SECRET`, and `_KEY` values with random hex (never `GOOGLE_*`). Refuses if `.env` exists.
- `pnpm run php composer <script>` — runs a root `composer.json` script in the PHP tools container, as the host's own `uid:gid`. Never put `--` before `composer`: pnpm 11 passes it through and the container runs nothing, exiting 0. See "PHP" in `docs/testing.md`.
  - `composer lint` — PHPCS (WPCS + PHPCompatibilityWP) over `plugin/moving-quote`.
  - `composer analyse` — PHPStan level 9 over the plugin source and `tests/php`.
  - `composer test` — PHPUnit over `tests/php`, no WordPress bootstrap.
  - `composer check` — lint, then analyse, then test.
  - `composer autoload:plugin` — regenerates the committed `plugin/moving-quote/vendor/`. Run it and commit whenever the PSR-4 mapping changes; CI fails on drift.
- `docker compose ls` — list running stacks; run it before starting this one (see "The local stack").
- `docker compose up -d --wait` — start every service and wait until all are healthy.
- `./setup.sh` — install and configure WordPress against the running stack. Idempotent.
- `docker compose down` — stop the stack. `-v` also drops the named volumes, wiping WordPress, MySQL, Postgres, and n8n data.
- `docker compose -f compose.yaml -f compose.queue.yaml up -d --wait --scale n8n-worker=2` — queue mode: Redis plus workers that run the executions. `n8n-worker` extends `n8n` (same encryption key, database, and read-only `/files` mounts) with its port reset so it can scale.
- `docker compose -f compose.yaml -f compose.queue.yaml down && docker compose up -d --wait` — back to the single-process stack; plain `down` keeps the volumes.
- `pnpm run test:stack` — the full stack suite (`tests/stack/**`). Needs the whole stack healthy and `./setup.sh` run; CI's `stack` job runs it on every PR.
- `pnpm run test:stack:wp` — only `tests/stack/wp/`, which needs just MySQL, WordPress, and WP-CLI.
- `pnpm run db:migrate` — applies pending `db/migrations/` files, then resets `app_runtime`'s password and attributes. It stops before touching the database on a transaction-control statement, a role-name clash, or an unset `\getenv` variable; a second run prints `no pending migrations`. See `docs/database.md`.
- `pnpm run setup` — runs `db:migrate`, imports credentials, then publishes workflows (`node scripts/setup.ts`, so `-- --refresh <id>` reaches the credential step). It skips a credential with blank `.env` values, or an existing one unless named with `--refresh <id>` (repeatable): re-importing drops an interactive Google sign-in. (`--refresh cvbCredAppDb0001` is also the one-time move of an existing stack's `App DB` credential onto `app_runtime`; see "Credentials" in `docs/database.md`.) It verifies every manifest workflow id landed (`n8n list:workflow --onlyId`) and retries the import once, since a freshly written file can still be settling onto the bind mount; it fails naming any id still missing.
- `node scripts/check-db.ts` — proves `app_runtime`'s denials, exact grants, the one workflow statement (rolled back), and the migration ledger, printing `ok` or `FAIL` per check and exiting 1 on any failure. `tests/stack/n8n/runtime.test.ts` runs it, so CI needs no separate step. See `docs/database.md`.
- `pnpm run export` — writes n8n's canonical form of every known workflow back to `workflows/` and regenerates the Code nodes. Run it after editing a workflow in the n8n UI, and commit the result.
- Regenerate a diagram after editing its source in `docs/diagrams/`. The tool is [archify](https://github.com/tt-a1i/archify), Node.js with no install step, last checked at v3.2.0.

  Clone it outside this repo, so `pnpm run lint` never scans it: `git clone --depth 1 --branch v3.2.0 https://github.com/tt-a1i/archify ../archify`. Run from the repo root, since each source's `meta.output` is relative to it. For the architecture diagram (type `architecture`):
  1. `node ../archify/archify/bin/archify.mjs validate architecture docs/diagrams/architecture.json --quality showcase --json` after every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings.
  2. `node ../archify/archify/bin/archify.mjs deliver architecture docs/diagrams/architecture.json docs/diagrams/architecture.html --quality showcase --json` writes the page, plus the gitignored `docs/diagrams/architecture.delivery.json` receipt.
  3. Open the page, choose **Export**, then **SVG · Auto**, and save over `docs/diagrams/architecture.svg`, which `README.md` and `docs/architecture.md` embed.
  4. Optionally, `node ../archify/archify/bin/archify.mjs visual-check docs/diagrams/architecture.html --json --out-dir ../archify-evidence` checks the page at four desktop sizes, writing screenshots outside the repo.

  For the sequence diagram, repeat with type `sequence` and the `lead-sequence` files; only `docs/architecture.md` embeds its SVG.
- n8n's `import:workflow`, `export:workflow`, `import:credentials`, `export:credentials`, and `publish:workflow` need no owner account, `--userId`, or `--projectId` (checked against `2.45.6`). `publish:workflow` takes effect only after a restart, which `pnpm run setup` does only when it published something (see "Changing a workflow").

## The local stack

- **Services and ports.** `db` (MySQL 8.4, unpublished), `wordpress` (`127.0.0.1:8080`), `wpcli` (idle, for one-off `wp` commands), `cron` (`wp cron event run --due-now` every 60 s, since WP-Cron is disabled), `postgres` (unpublished), and `n8n` (`127.0.0.1:5678`).
- **One stack at a time.** Every demo in this series binds `127.0.0.1:5678`, and this one also binds `8080`. Run `docker compose ls` and stop any other demo's stack first, or `up` fails on the port or a test talks to the wrong n8n.
- **`setup.sh`** needs `docker compose up -d --wait` first. It waits until MySQL accepts connections, installs WordPress (admin password over stdin), sets the description, timezone, and pretty permalinks, activates the default theme and the plugin, creates the `home`, `get-a-quote`, and `thank-you` pages and a `primary-navigation` menu (Home, Get a Quote), and sets the delivery settings (see "Settings"). `SITE_LOCALE` picks the language; see "Translations".
  - It's idempotent, and leaves an existing page or menu exactly as it is, since the owner may have edited it. To get the current Thank You copy on an older stack, delete that page (`docker compose exec -T wpcli wp post delete <id> --force`) and rerun.
- **Stack tests never use `wp db query`.** The `wpcli` image's MariaDB client isn't guaranteed compatible with MySQL 8.4; `sqlWp()` runs `wp eval-file -` through WordPress's own `$wpdb` instead.

## Changing a workflow

1. Design the nodes and expressions against n8n's own node reference and real examples.
2. Edit the JSON in `workflows/` (fixed IDs and credential IDs from `scripts/lib/manifest.ts`), then run `pnpm run build:workflows`.
3. Validate with an n8n-aware tool until it reports no errors. Its stale Postgres `typeVersion` ceiling is not a real error; never downgrade the node (see "n8n workflows").
4. Run `pnpm run setup` to import and publish it locally.
5. Run `pnpm run export` and commit that exported form, not your hand-edited JSON: it can differ in server-assigned detail, and it's what actually runs.
6. Run `pnpm run setup` and `pnpm run export` again, then `git diff --exit-code workflows/`. A diff means a field leaks instance state; extend the volatile-fields list in `scripts/lib/normalize-workflow.ts`.
7. Run the full gate before committing.

Right after a restart, `/healthz` is healthy before the publication reconciler syncs the active version (every 10 s by default), so a call can still run the old one. `pnpm run setup` waits 15 s past `/healthz`, then polls each manifest `webhookPath` until it answers 401. After any other `n8n` restart, wait the same 15 s.

## Install lifecycle

- **Single-site only.** `Installer::activate( bool $network_wide = false )` refuses with `wp_die()` (`back_link: true`) whenever `is_multisite()` is true, per-site activation included. See "Single-site only" in `docs/architecture.md` for the SSRF reason.
- **Activate** creates the leads table through `dbDelta` (`Install\Schema::sql()`), seeds `moving_quote_settings` without overwriting, sets `moving_quote_db_version`, and schedules the outbox hook.
- **Deactivate** only clears the hook; the table and both options stay.
- **Upgrade.** `Installer::maybe_upgrade()` runs on every `plugins_loaded` and reruns `dbDelta` when the stored version differs. `DB_VERSION` is `'2'`, which added `locale` (`varchar(20)`, default `''`). A new column goes last in `Schema::sql()`, since `dbDelta` appends it; an existing row keeps `''`, which n8n reads as the default language.
- **Uninstall** (`uninstall.php`, only when WordPress deletes the plugin) drops the table, both options, the rate-limit transients, and the hook. It's the one path that removes data.
- **Cron.** Hook `moving_quote_process_outbox` on `moving_quote_every_minute` (60 s, added through `cron_schedules`); `Plugin::boot()` wires it to `Delivery\Outbox::process_due()`.

## Settings

- **Admin page.** `Admin\Menu::register()` adds "Moving quotes" (`manage_options`, `dashicons-car`) and its Settings submenu, rendered by `Admin\SettingsPage::render()` in three sections: rates, cities and distances (existing routes, three blank rows, a remove checkbox, and a warning listing any missing city pair), and delivery.
- **Sanitizing a save.** `SettingsPage::sanitize()` uses `esc_url_raw()` for the webhook URL and only `trim()` for the secret and team email, never `sanitize_text_field()` or `sanitize_email()`, which can silently turn a bad value into `''` before validation. The pure `Settings\SettingsSanitizer` then keeps a field's current value and reports an error code on invalid input. `options.php` has already unslashed the value.
- **The webhook secret.** A blank field keeps the stored secret; only a non-blank value (at least 32 characters) replaces it. The field is always `type="password"` with an empty value, so the HTML never contains it.
- **Delivery gating.** `Settings\Options::delivery_enabled()` is true only once the webhook URL, secret, and team email are all set; the page says "Delivery is on" or "Delivery is off until the webhook URL, secret, and team email are set."
- **`setup.sh`'s delivery keys.** It sets `webhook_url` to the in-network n8n address, and patches `webhook_secret`/`team_email` from `.env`'s `LEAD_WEBHOOK_SECRET`/`TEAM_EMAIL` with `wp option patch update`, both over STDIN.

## Leads admin

- **The page.** "Moving quotes" and its "Leads" submenu render `Admin\LeadsPage::render()`, which requires `wp-admin/includes/class-wp-list-table.php` (not autoloaded) before using `Admin\LeadsListTable`. Columns: Received (`America/Bogota`), Reference, Customer (name, phone, email), Move (date, type label, "N rooms"), Route (origin → destination, km), Estimate (the REST API's `COP low – high`), Status, and Delivery.
  - Status is a per-row form posting to `admin-post.php`, its `<select>` labelled "Status of lead MQ-…", with a "Delete" link. Delivery shows the sync label, attempts, `last_error` (also in a `title`), and "Retry delivery" on `failed` rows.
  - Each cell has core's markup (`data-colname`; a `<th scope="row">` with "Show more details" for the primary Received column), so narrow screens collapse rows into labelled lines.
  - Views: All plus the five `LeadStatus` values, each with a live count; 20 rows per page; an unknown `status` reads as "All".
  - `single_row_columns()` calls each `column_$name()` directly, and each escapes its own output. Never run that markup through `wp_kses_post()`, which strips the status `<form>`, `<select>`, and `<input>`.
- **The handlers.** `LeadsPage::register_hooks()` wires four `admin_post_moving_quote_*` actions. `admin-post.php` has no capability gate of its own, unlike a menu page, which core's `wp-admin/includes/menu.php` denies with 403 before any callback runs, so each handler checks `manage_options` first, dying with an explicit `403` (`wp_die()` defaults to 500), then `check_admin_referer()`.
  - `handle_update_status()` applies the posted `status` through `LeadRepository::update_status()`; an unknown value is a no-op. It redirects with a notice.
  - `handle_retry()` calls `LeadRepository::requeue()`, which acts only on a `failed` row: back to `pending`, 0 attempts, due now. The notice says "queued for delivery", never "sent": cron delivers.
  - `handle_delete()` calls `LeadRepository::delete()` after `manage_options` (inside `require_id()`) and the row's own `moving_quote_delete_lead_{id}` nonce. The link confirms with `confirm()` first.
  - `handle_export()` sends `nocache_headers()`, `text/csv; charset=utf-8`, and `attachment; filename="moving-leads-{Y-m-d in Bogota}.csv"`, then a UTF-8 BOM, `Admin\LeadCsv::HEADER`, and `LeadRepository::chunk_after()` batches of 500 (an ascending-id cursor, so no row is skipped or re-read) through `fputcsv( $out, $row, ',', '"', '' )`, whose row terminator is `\n`. It `exit`s right after, so nothing can `echo` onto the stream.
- **CSV safety.** `Admin\CsvEscaper::cell()` (pure) prefixes `'` to a value starting with `=`, `+`, `-`, `@`, tab, or carriage return, the prefixes spreadsheets read as a formula; `null` becomes `''`. `Admin\LeadCsv::row()` (pure) converts `created_at` (UTC) to `received_at` (`Y-m-d H:i`) and keeps every other field raw, not as a label, so the export reads the same in any admin language. Every cell passes through `CsvEscaper`.
- **The stuck-delivery notice.** `Admin\StuckDeliveryNotice` shows a `notice-warning` to `manage_options` users on the Dashboard or the Leads page (`'toplevel_page_' . Menu::SLUG`) when `LeadRepository::count_stuck()` is non-zero: every `failed` lead, plus every `pending` one over an hour old, excluding `won` or `lost`. It links to the Leads page. A second notice shows the rate-limited `submit` count for the current 24-hour window once non-zero.
- **Personal data.** `Admin\PersonalData` registers an exporter and an eraser keyed by email, reached only through core's Tools → Export/Erase Personal Data. Core requires `manage_options` and owns the request (a confirmation email, then the export or erasure), calling both directly rather than through `admin-post.php`, so neither needs its own nonce.
  - `export()` returns every field of every matching lead under `moving-quote-leads`, with display labels for the move type and extras, plus the lead's site language.
  - `erase()` deletes every matching row in one statement (`LeadRepository::delete_by_email()`) and reports `items_removed`. Copies can remain in the sheet, the two sent emails, and for up to 168 h a failed n8n execution, so when it deleted a row it also reports `items_retained => true` and names each `MQ-…` reference (from `uuids_by_email()`, read before the delete) to remove by hand. See retention in `docs/database.md`.

## REST API

- **`POST /wp-json/moving-quote/v1/estimate`** (`Rest\EstimateController`). No nonce. Rate limit `estimate`, 120 per 600 s. Prices with `LeadValidator::quote()` and `Pricing\Calculator` against the current settings. Answers 200 with the estimate, 422 `moving_quote_invalid` (`data.errors`, field to message), or 429 `moving_quote_rate_limited` with `Retry-After`.
- **`POST /wp-json/moving-quote/v1/leads`** (`Rest\LeadController`). Requires `X-WP-Nonce` (action `wp_rest`). In order: nonce, honeypot (`website`), validation (`LeadValidator::lead()`), pricing, a duplicate lookup by `submission_id` (= `request_uuid`), the `submit` rate limit, then the insert.
  - **The `submit` limit (5 per 3,600 s) counts only a lead about to be inserted**, so a corrected typo or a double tap never spends it.
  - **Neither route has an `args` schema.** Core would answer its own 400 `rest_invalid_param` before the 422 contract; `LeadValidator` validates every field instead.
  - **Two nonce errors.** A missing header gets the plugin's 403 `moving_quote_bad_nonce`. A stale or forged nonce is rejected first by core's `rest_cookie_check_errors` with 403 `rest_cookie_invalid_nonce`. The estimate route must never receive a nonce from the frontend.
  - Responses: 201 `{"ok":true,"reference":"MQ-…","estimate":{…}}` for a new lead; 200 with the same shape for a duplicate `submission_id` (nothing saved or counted); 201 `{"ok":true}` for a filled honeypot (nothing saved); 422 `moving_quote_invalid`; 429 `moving_quote_rate_limited`; 500 `moving_quote_save_failed` for any other insert failure (logged without PII).
- **`Security\RateLimiter`** keeps fixed-window counts in transients keyed `moving_quote_rl_{bucket}_{hash}`, hashed from the client IP so no IP is stored. A MySQL named lock (`GET_LOCK`/`RELEASE_LOCK`) guards the read-check-write. `acquire_lock()` counts only MySQL's `'1'` and Playground's SQLite answer `'1=1'` as granted, so `'0'`, `NULL`, or anything else fails closed.
  - **`moving_quote_client_ip`.** `client_ip()` reads `REMOTE_ADDR`, which behind a reverse proxy is the proxy's address. Filter it only once `REMOTE_ADDR` is a trusted proxy, and never trust `X-Forwarded-For` or `CF-Connecting-IP` unconditionally; see "Behind a reverse proxy" in `docs/architecture.md` for the example.
  - **`moving_quote_rate_limits`.** `Security\RateLimits::estimate()`/`::submit()` read both buckets through this filter, which receives and returns the full `['estimate' => [...], 'submit' => [...]]` shape; a missing or malformed entry falls back to the defaults (120/600 s, 5/3,600 s) for that bucket. Neither controller hardcodes a limit.
  - **Rate-limited submissions are counted.** Each `/leads` 429 calls `RateLimiter::record_rate_limited_submission()`, which increments one transient (`RATE_LIMITED_COUNT_TRANSIENT`) with no IP or per-visitor data. Its 24-hour window is fixed from the first counted 429, not rolling. `StuckDeliveryNotice` shows it.

## Delivery

Every saved lead is sent to n8n as a signed request: once right after the insert, then through a cron-driven outbox that retries with backoff.

- **Signing and payload.** `Delivery\JwtSigner::hs256()` signs claims into a compact HS256 JWT (unpadded base64url). `Delivery\LeadPayload::body()` builds the exact contract body (`JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR`; `submitted_at` is `created_at` in `America/Bogota` as `DATE_ATOM`; `locale` is the stored `determine_locale()` value, or `''` for an older row). `tests/fixtures/lead-payload.json` holds that body for one fixed lead, read by `tests/php/Delivery/LeadPayloadTest.php`. `LeadPayload::claims()` derives `jti` (= `request_uuid`), `iat`, `exp` (`iat + 300`), and `body_sha256` from the built body, so the signature binds the exact bytes sent.
- **Response checks and retries.** `Delivery\ResponseCheck::acknowledged()` alone decides delivery: a 2xx whose JSON `status` is `accepted` or `duplicate`. `Delivery\Backoff::delay_after()` waits `min(60 × 2^(n-1), 21600)` s after the n-th failure, giving up after `MAX_ATTEMPTS` (10). `Delivery\SyncTransition::after_attempt()` turns an outcome into a `Delivery\SyncUpdate` (`sync_status`, attempts, `next_attempt_at`, `last_error` cut to 500 characters with `mb_substr`, `sent_at`), with an exact PHPUnit case for every row of the table.
- **`Delivery\WebhookClient::send()`** is the one caller of `wp_remote_post()`, not `wp_safe_remote_post()`, whose SSRF guard would block the admin-set private Docker hostname. 5 s timeout, no redirects. It returns null on an acknowledged 2xx, or the error text: a `WP_Error` message, `HTTP {code}: {excerpt}`, or `Unexpected response (HTTP {code}): {excerpt}`.
- **`Delivery\Outbox`.** Delivery is at-least-once: n8n dedupes on `jti`, and `apply_sync()`'s `pending` guard keeps a `sent` row `sent`.
  - `deliver( LeadRecord $lead )` builds and signs the request, sends it, and stores the `SyncUpdate` through `LeadRepository::apply_sync()`; it claims nothing.
  - `process_due()` is the cron entry point. It returns 0 without querying when delivery is off; otherwise it loads up to `BATCH_SIZE` (20) rows from `due()`, claims each with a lease counted from that claim (not the batch start), and delivers only what it claimed.
  - A row whose `status` `LeadRecord::from_row()` can't parse (`ValueError`, likely another plugin version) is recorded as a failed attempt from its stored `attempts` and skipped, so the batch continues.
  - **Every internal failure counts as an attempt.** A caught `Throwable` goes through `SyncTransition::after_attempt()` with `last_error` `Internal error: {class}`, never the message (it could carry PII), so a persistent fault backs off to `failed`. It isn't logged separately.
  - **Stale workers are guarded.** `LeadRepository::claim( $id, $expected_next_attempt_at, $lease_until )` updates only on a matching `id`, `next_attempt_at`, and `sync_status = 'pending'`, true only when exactly one row changed; `apply_sync()` writes only while `pending`.
    - NOTE: a runner stalled past its lease can be overtaken, and if the second runner fails and the row returns to `pending`, the first runner's late write can mask that outcome. Upgrade path: fence `apply_sync()` on the lease value `claim()` issued.
  - **`LeadController`'s inline attempt** calls `deliver()` in a try/catch only after a *new* insert and only when delivery is on, with no claim: `insert()` already set `next_attempt_at = now + LEASE_SECONDS`. The response is 201 regardless, though it can wait up to the 5 s timeout.
- **Stack tests.** `startReceiver()` stands in for n8n's webhook, `signHs256()`/`decodeVerified()` sign and verify JWTs (asserted with `not.toBeNull()`, never by comparing a secret), `deleteCreatedLeads()` runs in every lead-creating file's `afterAll`, and `disableDelivery()` keeps a file's leads off the real n8n. `tests/stack/wp/delivery.test.ts` also parks other pending rows and filters requests by `request_uuid`, on top of `global-setup.ts` stopping `cron`. Details in `docs/testing.md`.

## n8n workflows

`docs/architecture.md`'s "The workflows, node by node" documents every node, its pinned parameters, and why. The rules a change must keep:

- **`lead-intake`** (`cvbLeadIntake001`): the native `jwtAuth` check, then `Verify request` for what it doesn't cover (lifetime, skew, body hash, contract, `jti` binding), then the `processed_events` insert as the idempotency gate. It answers `accepted` or `duplicate` (both 200), and hands off to `process-lead` fire-and-forget only after `accepted`.
- **Postgres stays at v2.8.** n8n 2.45.6 runs it; the n8n-mcp validator's `typeVersion 2.8 exceeds maximum supported version 2.7` is its own stale data. `tests/workflows.test.ts` pins 2.8; never downgrade to silence the tool.
- **Anchor with `.first()`**, never `.item`, in every cross-node reference, `process-lead`'s `$('When called').first().json.lead...` included. NOTE: correct only while one call carries one lead; batching leads would need a different anchor.
- **`move.date` is checked only as a calendar date in n8n.** The today-to-365-days window is WordPress's rule; enforcing it in n8n would reject legitimate retries.
- **`Read config`** keeps `alwaysOutputData: true` and `executeOnce: true`, in both `lead-intake` and `error-handler`.

### process-lead

- `cvbProcessLead01` builds the row and both emails in `Map lead`, appends the row, then sends both emails, wired from **Append lead row** so a lead that never reached the sheet notifies no one.
- Keep `options.cellFormat: 'RAW'` (phones and formula-looking names stay text) and `options.handlingExtraData: 'error'` (a renamed header fails and alerts instead of adding a column).
- Never set `options.senderName` on a Gmail node: it needs `GET users/me/profile`, which `gmail.send` doesn't authorize. `options.appendAttribution` stays `false`.
- Email team stays plain text with no `tel:`/`mailto:` links; the customer email stays escaped HTML. Both email rules and the line-break guards are in "Output safety" and "Why Email team is plain text" in `docs/architecture.md`.
- Appending before emailing has a cost (a failed append sends no email, with only the operator alert as a signal, and an expired Google grant silences that too); see the known gaps in `docs/architecture.md`.

### error-handler

- `cvbErrorHandler1` is every other workflow's `settings.errorWorkflow`. It reads config through its own nodes, never a sub-workflow, so a missing config fails it once with no alert loop; it has no `errorWorkflow` of its own.
- Every **Email operator** field anchors on `$('On workflow error').first().json` with fallbacks, because `$json` there is `{ config }` and an activation error has no `execution` key.

Verified n8n 2.45.6 behavior (a workflow publishes before its credentials exist; production runs use the published version) is under "Publishing and versions" in `docs/architecture.md`. The false-duplicate gap and its recovery commands are in its failure modes; the stored-token exposure is under "Token retention, precisely".

**Keeping test leads away from live Google.** Every stack case that reaches `process-lead` skips once `googleCredentialsConfigured()` finds either Google credential (`googleCredentialIds(CREDENTIALS)`, from a non-decrypted export). See "The live-Google skip guard" in `docs/testing.md`.

## The quote form

- **Shortcodes.** `[moving_quote]` (`Frontend\Shortcode::TAG`) takes one optional attribute, `thank_you` (the redirect page slug, default `thank-you`). `register_assets()` registers the script (footer, `strategy: 'defer'`) and style on `init`, versioned with `Plugin::VERSION`: bump it whenever either changes, or returning visitors keep the cached copy. `render()` enqueues them, so they load only where used. `[moving_quote_reference]` (`Frontend\ReferenceShortcode`) prints "Your reference number is MQ-…" from the `reference` query arg only when `LeadRecord::is_reference()` matches (`MQ-` and 8 uppercase hex digits), and never looks it up, so the page can't probe which leads exist.
- **Markup** (`templates/quote-form.php`). A `<form data-moving-quote data-config="…">` with a numbered progress `<ol role="list">` (markers `aria-hidden`, `aria-current="step"` on the current one), three `<fieldset>`s, a `role="alert"` error region, a hidden inline success message, the estimate panel, a honeypot, and a `<noscript>` fallback.
  - The honeypot (`name="website"`) sits in an off-screen, `aria-hidden="true"` wrapper out of the Tab order (`tabindex="-1"`).
  - Move type, rooms (1–5, "5+"), and both city selects render server-side from `Pricing\MoveType` and `DistanceTable::cities()`; each city select starts with a disabled "Choose a city". Name, phone, and email carry `autocomplete`.
  - `data-config` is `wp_json_encode()` through `esc_attr()`, so no merchant-editable string can break out of the attribute.
- **The markup contract.** `quote-form.ts` finds everything through hooks, never layout: `[data-step]`, `[data-progress-step]`, `[data-next]`/`[data-back]`/`[data-submit]`, `[data-error-for="<field>"]` (each the `aria-describedby` target `mq-error-<field>`), `[data-form-error]`, `[data-success]` with `[data-success-reference]`/`[data-success-reference-value]`, and `.moving-quote__estimate` with `[data-estimate-result]`, `[data-estimate-value]`, `[data-estimate-error]`, and `[data-estimate-hint]`. Rename one only together with `quote-form.ts`.
- **Frontend behavior** (`src/frontend/`).
  - One browser-minted UUID v4 `submission_id` per page load, reused on every retry.
  - Estimates run through `debounce(createEstimateFetcher(...), 300)`. `createEstimateFetcher()` wraps only `postJson()` in `latestOnly()` and writes the display itself when the result `!== undefined`, because `latestOnly()` discards a superseded return value, not side effects.
  - The panel's `data-estimate-state` is `idle` (with a hint), `loading` (`aria-busy="true"`, so the live region announces only the final price), `ready`, or `error` (the dash plus a message that the request can still be sent).
  - Changing steps focuses the new `<legend>`; Enter before the last step means "Next".
  - Submit disables the button and shows "Sending…". A 2xx redirects to the thank-you page with `?reference=MQ-…`, or, with no such page, shows the inline success and focuses it. A 422 returns to the first step with an error and focuses its first invalid control. A 403 (either nonce code), a 429, or a network failure shows its message and re-enables the button. Only a genuine 2xx shows success or leaves the button disabled.
- **Styles** (`assets/quote-form.css`). Every color, radius, and spacing value is a `--mq-*` token on `.moving-quote`. The form draws its own light surface (`color-scheme: light`); the README's "The quote form's design tokens" lists each pair's WCAG ratio. Type inherits family and weight, with size clamped to `1rem`–`1.25rem`. A container query on the form itself, not the viewport, switches one column to two, so it also fits a narrow sidebar on a wide screen. Controls are at least 44 px tall; only `:focus-visible` draws the ring; motion is 150 ms on color, opacity, or transform, and `prefers-reduced-motion` drops it (spinners pulse instead of turning).
- **The generated asset.** `quote-form.js` is built by `pnpm run build:assets` and committed; never edit it by hand.
- **Field messages.** `Rest\Messages::fields()` maps error codes to text for both endpoints. Phone and email name a valid value ("Enter a phone number with 10 to 15 digits.", from `LeadValidator::PHONE_MIN_LEN`/`PHONE_MAX_LEN`; "Enter an email address like name@example.com."); other fields share the generic text.

## Trying the plugin in Playground

The two English blueprints share their top level (`$schema`, `landingPage: '/get-a-quote/'`, `preferredVersions: { php: '8.3', wp: 'latest' }`, `login: true`) and an identical `steps.slice(1)`: `setSiteOptions` for identity and permalinks, then `wp-cli` steps that create the pages and `primary-navigation` menu with `setup.sh`'s copy, set the front page, and flush rewrites. Only the first step differs:

- **`playground/blueprint.json`** (public). `installPlugin` from a `git:directory` resource (this repo's `main`, `plugin/moving-quote`) with `options.activate: true` and `options.targetFolderName: 'moving-quote'`, pinned so the folder name never depends on Playground's guess. Open `https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/aabv21/wordpress-moving-quote-plugin/main/playground/blueprint.json` once the repo is public (deferred: it's private, so the GitHub install is unchecked).
- **`playground/blueprint.local.json`** (local CLI). `{ "step": "activatePlugin", "pluginPath": "moving-quote/moving-quote.php" }`, since `--mount` already places the plugin. Run, then open <http://127.0.0.1:9400>:

  ```sh
  pnpm dlx @wp-playground/cli@3.1.61 server --php=8.3 --port=9400 --mount=./plugin/moving-quote:/wordpress/wp-content/plugins/moving-quote --blueprint=playground/blueprint.local.json
  ```

  `@wp-playground/cli` stays pinned at this exact version.
- **`playground/blueprint.es.json`** (public, optional). The public blueprint in Spanish: the same `installPlugin`, then `{ "step": "setSiteLanguage", "language": "es_CO" }` (core's Spanish files download; the plugin's ship with it), then the same steps with `setup.sh`'s `es_CO` copy. Open it at `https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/aabv21/wordpress-moving-quote-plugin/main/playground/blueprint.es.json` once the repo is public.

`tests/playground.test.ts` keeps all three in sync: the English two's `steps.slice(1)` deep-equal, the Spanish one the same steps with only copy changed, and each carrying `setup.sh`'s copy for its language word for word.

**Delivery stays off in Playground**: there's no `.env`, so `setup.sh`'s delivery settings never apply, and a lead shows "Pending (0 attempts)". What was verified there (the mount and `wp-cli` behavior, SQLite compatibility, the lock-value fix, the exact estimate response) is in `docs/testing.md`'s Playground section.

## Translations

English is the source language; Spanish (Colombia) is the one translation. Spanish lives only in `moving-quote-es_CO.po`, in `map-lead.ts`'s `{ en, es }` `MESSAGES`, and in the Spanish page copy (`setup.sh`'s `es_CO` branch, `playground/blueprint.es.json`), never in plugin logic. Spanish copy uses *usted* with customers, in a neutral Latin American, Colombian business register.

- **The plugin's strings.** Every user-visible PHP string goes through `__()`, `esc_html__()`, `esc_html_e()`, `_n()` (anything with a count), or `_x()` (context-dependent short strings: lead and delivery statuses, route column headings), with the `moving-quote` domain and a `/* translators: */` comment on any placeholder. PHPCS's `WordPress.WP.I18n` enforces the domain. `Plugin::boot()` loads it on `init`. The script has no gettext calls: its strings arrive translated through `data-config` (`Frontend\Shortcode::config()`), and estimates use the server's `display` text (`number_format_i18n()`).
- **Adding or changing a string.** Edit the PHP, bring the stack up, run `pnpm run i18n`, update `moving-quote-es_CO.po` (no `fuzzy`, every plural form, the same placeholders and markup), run `pnpm run i18n` again, and commit all four files. `tests/i18n.test.ts` catches a missing, removed, empty, or fuzzy message or a changed placeholder or tag; CI's `stack` job catches a stale `.pot`, `.mo`, or `.l10n.php`. The `.pot` has no `#: file:line` (`--no-location`), so only a changed string makes it stale.
- **Adding a language.** Copy the `.pot` to `moving-quote-<locale>.po`, fill the header (`Language`, `Plural-Forms`, and a fixed `POT-Creation-Date`, which keeps the compiled files byte-stable) and every message, run `pnpm run i18n`, and commit. The n8n emails need a new `MESSAGES` key and `normalizeLocale()` support.
- **Switching the site language.** Settings → General → Site Language, or `SITE_LOCALE=es_CO ./setup.sh` (or in `.env`). `es_CO` downloads core's language pack, so it needs network access; the plugin's translations need none. On a fresh stack it creates Spanish pages (same slugs); on an existing one it only switches the language. `./setup.sh` (or `SITE_LOCALE=en_US`) switches back. Thousands separators come from that core pack (`1.017.000`); without it, `1,017,000`.
- **The lead's language.** `LeadController` stores `determine_locale()` in `locale`, and the payload sends it. `parseLead()` reads it through `normalizeLocale()` (`es_CO`, `es-CO`, `es` → `es`; `en_US`, `en` → `en`; anything else, empty, or missing → `en`). The customer email follows the lead; the team email follows `config.json`'s `team_locale` (`en` or `es`, `en` when absent). An invalid `team_locale` never fails a lead: the team alert falls back to English with a note, since config travels in each execution's input and a throw would block every retry. `parseTeamLocale()` stays strict for checking a config file.
  - **Deploy order:** publish the workflows (`pnpm run setup`) before updating the plugin. An older `lead-intake` answers a lead carrying `locale` with 422 (`hasOnlyKeys`), and WordPress retries until `failed`.
- **A visitor-facing language switcher needs a multilingual plugin** (Polylang, WPML, TranslatePress, …). The plugin renders in whatever `determine_locale()` returns per request, so the form, the stored `locale`, and the customer email follow it with no change here.

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM. `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit`: there is no build step.
- No `.js` or `.mjs` sources. Scripts are `scripts/*.ts`, run with `node scripts/<name>.ts` (native type stripping; no `tsx`). The only JavaScript is generated: `quote-form.js` and each Code node's `jsCode`.
- A test outside `tests/stack/` never imports `tests/stack/lib/stack.ts`, directly or transitively: it loads `.env` at import time, and CI's quality job has none. A helper shared by stack files with no live-stack dependency goes in its own side-effect-free module (e.g. `tests/stack/lib/poll.ts`). `eslint.config.ts` enforces this.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import them.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- No hand-written Code node: each is `export function run(input) { ... }` in `src/nodes/<name>.ts` (pure, no I/O, no clock), compiled by `pnpm run build:workflows` and listed in `CODE_NODES`. Sources use the ambient `DateTime` global, since the sandbox has no `require`, Node builtins, `fetch`, `window`, or `document`.
- n8n's Task Runner sets `Object.defineProperty = () => ({})` before running `jsCode`, which would make every esbuild export vanish. `hardenAgainstFrozenDefineProperty` in `scripts/build-workflows.ts` patches that, tested against a simulated frozen sandbox; keep it, and re-check it before moving `esbuild` past its exact pin.
- A Postgres query's SQL comments never contain `$n` (`pnpm run check` enforces it): n8n substitutes placeholders in the raw text, comments included, so a bound value with a newline can end a `--` comment and inject SQL. Document a parameter in the sticky note instead.
- PHP: every file starts with `declare(strict_types=1);`. Class files in `src/` hold only declarations, with no `ABSPATH` guard, so PHPUnit loads them; `moving-quote.php` and `templates/quote-form.php` start with `defined( 'ABSPATH' ) || exit;`, `uninstall.php` with `defined( 'WP_UNINSTALL_PLUGIN' ) || exit;`. Pure classes never call WordPress, except `Rest\Messages::field()`, which needs `__()`. `Frontend\Shortcode` and the template are WordPress-coupled, so the stack suite covers them. PHPStan level 9 needs typed array shapes on every helper and data provider that touches an array.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials, never in code, workflow JSON, or committed config. `scripts/init-env.ts` never prints one. `scripts/setup-credentials.ts` detects existing credentials from an encrypted export and logs only names and ids, never `data`; credentials travel over stdin and stdout through the container's own `/tmp`, never the host filesystem or `.n8n-import/`.
- Test data: emails use `example.com`; phone numbers use the prefix `5700000000`; customer names are invented. Everything in the repo is in English.
- `pnpm run setup` never re-imports an existing credential unless named with `--refresh <id>`, which would drop an interactive Google sign-in.
- Generated files (`quote-form.js`, the plugin's `vendor/` autoloader, each `jsCode`) are committed, CI fails on drift, and none is edited by hand. Regenerate with `pnpm run build:assets`, `pnpm run php composer autoload:plugin`, or `pnpm run build:workflows`. The plugin's `composer.json` pins `version` and `autoloader-suffix`, so the autoloader is identical across commits.
- Point tooling only at this repo's local n8n instance. Validate workflows with an n8n-aware tool before importing them.
- **PR protocol.** Branch from `main`, commit, and open a PR with a summary and the verification run. Merge once CI is green.

## Supply-chain hardening

pnpm is pinned in `package.json`'s `packageManager` to an exact `11.x`; never move to pnpm 12 (Dependabot can't yet parse its two-document lockfile). `pnpm-workspace.yaml` holds the settings pnpm 11 no longer reads from `.npmrc`:

- `minimumReleaseAge: 4320` — no version (transitive included) younger than 3 days, so a compromised release can be caught first.
- `minimumReleaseAgeExclude: []` — overrides pnpm 11's default `n8n`/`n8n-*`/`@n8n/*` exemption; nothing is exempt.
- `trustPolicy: no-downgrade` — fails when a package's provenance or trusted-publishing evidence regresses, or the pinned pnpm would downgrade it. Exceptions live in `trustPolicyExclude`.
- `blockExoticSubdeps: true` — only a direct dependency may come from a git or tarball URL.
- `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false` — an install script fails unless approved in `allowBuilds`.
- `engineStrict: true` — a dependency whose `engines` excludes this Node fails the install.
- `allowBuilds` — only packages a real `pnpm install --frozen-lockfile` proved need a build, each with a one-line reason (`esbuild`, which re-links its platform binary). Add one only after the same proof.

`tests/supply-chain.test.ts` reads these back through `pnpm config list --json`, so a misspelled or ignored key fails. It also checks the `packageManager` shape, that `package-lock.json` is absent, that no tracked file teaches `npm` or `npx`, digest pins on every image (Compose, `docker run` in CI, the PHP Dockerfile), and, on the merged Compose config, `no-new-privileges` on every long-running service with `cap_drop: ALL` on `n8n` and `n8n-worker` only (the other images switch users at startup and need capabilities not yet proven safe to drop). See `docs/testing.md`.

**`trustPolicyExclude` holds three owner-approved exceptions**, transitive dependencies of `@wp-playground/cli` (through `@wp-playground/storage` → `octokit`, one also through `@octokit/app`) pulled in only by `pnpm dlx`, never `pnpm-lock.yaml`:

- `@octokit/endpoint@9.0.6` — a 2025-02-14 security backport on an old line, without provenance.
- `@octokit/plugin-paginate-rest@9.2.2` — a 2025-02-15 backport on the 9.x line, which never had provenance.
- `@octokit/webhooks@12.3.2` — a 2025-07-11 backport on an old line, without provenance.

Each is flagged only because a later major shipped with provenance first. **A new entry needs** an exact `name@version` (a bare name would exempt every future version), a `#` comment with the evidence (real publish date and why it's a false positive), the `trustPolicyExclude` assertion in `tests/supply-chain.test.ts` extended, and the owner's approval first.

**Updating a dependency:** edit `package.json`, run `pnpm install` (not `--frozen-lockfile`), run the gate, and commit both files together. When `minimumReleaseAge` refuses a version, wait or pin an older compatible one.

**Landing a security fix younger than 3 days:**
1. Add a temporary `minimumReleaseAgeExclude` entry for that exact `name@version` (e.g. `"esbuild@0.28.3"`, never a bare name), with a `#` comment naming the advisory and today's date.
2. Run `pnpm install` and merge as usual.
3. Remove the entry once the version is older than 3 days.

The supply-chain test goes red at step 1 on purpose, as the reminder for step 3; let it stay red for that PR rather than weakening the assertion. If that blocks merging, wait out the gate instead.

**Images** (`compose.yaml`, `compose.queue.yaml`, the Dockerfile's `FROM`/`COPY --from`) are pinned `name:tag@sha256:<digest>` with the multi-arch index digest from `docker buildx imagetools inspect name:tag`, so arm64 and amd64 both resolve. Dependabot refreshes an existing digest but never adds one; review a tag bump by hand and re-resolve its digest.

**`docker run` images in `ci.yml`** (ShellCheck, gitleaks, composer, actionlint) are pinned the same way, but Dependabot never parses a `docker run` line. Bump one by hand: pick the tag, then re-resolve its digest. The test checks only that a digest is present, parses references with or without an owner slash, and fails on any line it can't parse.

**CI** installs with `pnpm/setup` (pinned by SHA), `actions/setup-node` with `cache: pnpm`, `pnpm install --frozen-lockfile`, then `pnpm audit --audit-level=high`.

**Dependabot** (`.github/dependabot.yml`) adds a cooldown to every ecosystem: semver-tiered for `npm` (which covers the pnpm lockfile) and `composer` (14 days major, 7 minor, 7 patch), and a flat `default-days: 7` for `docker`, `docker-compose`, and `github-actions`, which lack a shared semver convention. Every version PR is therefore already past pnpm's 3-day gate. Security updates skip the cooldown.

### Composer (the PHP equivalent)

The root `composer.json`'s `config.policy` uses Composer 2.11's `policy.*` keys, never the deprecated `config.audit.*` keys, which Composer 2.11 marks for removal in a future major:

- `policy.advisories.block: true` — `update`/`require`/`remove` refuse a version with a known advisory. A plain `install` from the lock isn't blocked; `composer audit --locked` covers that.
- `policy.abandoned.block: false` with `policy.abandoned.audit: "fail"` — an abandoned package installs, but `composer audit` fails CI.
- `policy.cooldown.period: "3 days"` — mirrors pnpm's `minimumReleaseAge` for `update`/`require`.
- `allow-plugins` lists only the installed plugins (`phpstan/extension-installer`, `dealerdirect/phpcodesniffer-composer-installer`).
- `minimum-stability: "stable"` with `prefer-stable: true`.

`tests/supply-chain.test.ts` asserts every value above, that `allow-plugins` is an object, and that no `config.audit` key exists.

**Verifying the Composer policy:** `pnpm run php composer validate --strict`, `pnpm run php composer install` (if the lock won't resolve under the cooldown, wait; never loosen the policy), and `pnpm run php composer audit --locked --abandoned=fail`. CI's `quality` job runs `validate --strict`, `install`, `audit --locked --abandoned=fail`, `lint`, `analyse`, and `test`.

**Updating a PHP dependency:** edit `composer.json`, run `pnpm run php composer update <package>`, run the verification above, and commit `composer.json` and `composer.lock` together. For an urgent fix inside the cooldown, add a scoped, dated `policy.cooldown.ignore` entry and remove it after 3 days.

**The PHP image** is digest-pinned like the Compose images. After any change, `docker compose build php`, then rerun `pnpm run php composer check` and `pnpm run php composer audit`.

**Playground** runs through `pnpm dlx @wp-playground/cli@3.1.61`, not `npx`, so the same release-age gate and trust policy apply.

## Definition of done

- `pnpm run typecheck && pnpm run lint && pnpm test` all pass locally — run this full gate before every commit that touches TypeScript. Also run `pnpm run build:assets -- --check` (and commit a fresh `pnpm run build:assets` if it fails) before every commit that touches `src/frontend/**`, and `pnpm run build:workflows -- --check && pnpm run check` before every commit that touches `workflows/`, `src/nodes/**`, or `scripts/lib/manifest.ts`.
- `pnpm run php composer check && pnpm run php composer audit` pass locally — run this full gate before every commit that touches PHP.
- `pnpm run test:stack` passes locally against a running stack — run this before every commit that touches `compose.yaml`, `setup.sh`, or `tests/stack/**`.
- `pnpm run i18n -- --check` passes against a running stack — run this (and commit a fresh `pnpm run i18n` plus the updated `.po` if it fails) before every commit that adds, changes, or removes a translatable string.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and the `5700000000` phone prefix; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches what was asked — nothing extra, nothing missing.
