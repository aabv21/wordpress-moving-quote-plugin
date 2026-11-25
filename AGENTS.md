# AGENTS.md

Rules for anyone, human or AI, working in this repository. The reference lives in `docs/`; the Pointers section lists each file.

## What this is

Chivabox Movers' moving-quote plugin: a WordPress plugin that prices a move in a three-step form, saves each request in its own table, and delivers it to n8n as a signed request. n8n records the lead once, appends it to a Google Sheet, and emails the team and the customer. It is a portfolio demo: every file should read as production quality. Stack: WordPress 7.1 on PHP 8.3, n8n 2.45 on Postgres, strict TypeScript, Docker Compose.

## Map

- `plugin/moving-quote/`: the plugin (namespace `Chivabox\MovingQuote`). `src/` has `Pricing/`, `Settings/`, `Install/`, `Admin/`, `Leads/`, `Security/`, `Rest/`, `Delivery/`, `Frontend/`. The committed `vendor/` is a generated autoloader. `assets/` holds the stylesheets and the generated scripts; `languages/` the `moving-quote` text domain.
- `site/theme/`: the demo site's block child theme `chivabox`: tokens, patterns (the page copy), templates, fonts, photos, `languages/`.
- `site/mu-plugins/`: the demo site's own glue (Polylang for navigation menus), not part of the plugin.
- `src/frontend/`: the browser TypeScript (`quote-form.ts`, `thank-you.ts`, `form/`, `lib/`), bundled by esbuild into `plugin/moving-quote/assets/`.
- `src/nodes/`: the Code-node sources (`lead.ts`, `locale.ts`, `verify-request.ts`, `map-lead.ts`, `error-alert.ts`), bundled into each node's `jsCode`.
- `workflows/`: `lead-intake`, `process-lead`, `error-handler`, mounted read-only into n8n.
- `scripts/`: the TypeScript CLIs. `scripts/lib/manifest.ts` is the source of truth for fixed workflow, credential and Code-node IDs.
- `tests/`: Vitest (`frontend/`, `nodes/`, `tooling/`, `scripts/`, `dom/`, top-level suites), PHPUnit in `tests/php/`, the stack suite in `tests/stack/`, `fixtures/`, `lib/`.
- `compose.yaml`, `compose.queue.yaml`, `docker/php/`: the stack and the PHP tools image. `setup.sh` installs WordPress against it.
- `db/`, `config/`, `playground/`: the Postgres baseline and migrations, the n8n config template, the Playground blueprints.
- `docs/`: the reference. `.n8n-import/` is a live bind mount for `pnpm run export`.

The full layout, with every file group, is in `docs/architecture.md`, "Repository layout".

## Commands

- `pnpm install --frozen-lockfile`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test` (`pnpm test tests/dom` filters; no `--` before the path).
- `pnpm run build:assets` and `pnpm run build:workflows`, each with `-- --check`: bundle, or fail on drift.
- `pnpm run check`: hygiene checks over `workflows/`.
- `pnpm run php composer check` (lint, analyse, test) and `pnpm run php composer audit`. Never put `--` before `composer`.
- `pnpm run php composer autoload:plugin`: regenerate the committed `vendor/`.
- `pnpm run i18n` (`-- --check`): regenerate the `.pot`, `.mo` and `.l10n.php` in the running `wpcli` container.
- `docker compose ls`, then `docker compose up -d --wait` and `./setup.sh`; `pnpm run setup` imports credentials and publishes workflows.
- `pnpm run test:stack` (also `:wp` and `:n8n`), `pnpm run db:migrate`, `pnpm run export`, `node scripts/check-db.ts`.
- `node scripts/init-env.ts` writes `.env`; it refuses if one exists.

Every flag, side effect and the queue-mode command: `docs/testing.md`, "Command reference". Diagrams: `docs/diagrams/README.md`.

## Definition of done

Run before every commit that touches the area:

- TypeScript: `pnpm run typecheck && pnpm run lint && pnpm test`. Add `pnpm run build:assets -- --check` for `src/frontend/**` (commit a fresh `pnpm run build:assets` if it fails), and `pnpm run build:workflows -- --check && pnpm run check` for `workflows/`, `src/nodes/**` or `scripts/lib/manifest.ts`.
- PHP: `pnpm run php composer check && pnpm run php composer audit`.
- `pnpm run test:stack` against a running stack, for `compose.yaml`, `setup.sh` or `tests/stack/**`.
- `pnpm run i18n -- --check` against a running stack, for any added, changed or removed translatable string (commit a fresh `pnpm run i18n` and the updated `.po`).
- No secrets in the diff or history; `.env` and `config/config.json` are never committed.
- `README.md` (What it does, Quick start, Configuration, Test scenarios, Design decisions, Limitations, whichever the change touches) and these docs match what the change adds. Test data uses `example.com` and the `5700000000` phone prefix. Commits follow Conventional Commits.
- The PR states what was verified (commands and output) and lists deferred live checks. The diff matches what was asked.

## Rules an agent must not break

Generated files and tooling:
- Never hand-edit generated files: `quote-form.js`, `thank-you.js`, `vendor/`, each `jsCode`, and every `.pot`, `.mo` and `.l10n.php`. CI fails on drift. The plugin's `composer.json` pins `version` and `autoloader-suffix`.
- No `.js` sources. Code nodes are `src/nodes/<name>.ts` (pure, no I/O, no clock), built by `pnpm run build:workflows`. Re-check `hardenAgainstFrozenDefineProperty` in `scripts/build-workflows.ts` before moving `esbuild` past its exact pin.
- pnpm stays 11.x. Never touch `trustPolicy`, `trustPolicyExclude`, `minimumReleaseAge` or `minimumReleaseAgeExclude` without the owner (`docs/supply-chain.md`).
- Bump `Plugin::VERSION`, the header `Version:` and `plugin/moving-quote/composer.json` together whenever `assets/` changes (CONTRIBUTING.md).

n8n workflows (`docs/architecture.md`, "Rules a workflow change must keep"):
- Postgres stays at node v2.8; the validator's "exceeds maximum supported version 2.7" is stale data. Never downgrade.
- Anchor cross-node references with `.first()`, never `.item`.
- Append the sheet row matching `request_uuid`, never `reference`.
- The team email is plain text with no links; the customer email is escaped HTML. Never set `options.senderName` on a Gmail node; `appendAttribution` stays `false`.
- No `$n` in a Postgres query's SQL comments: n8n substitutes inside them.
- Publish workflows (`pnpm run setup`) before updating the plugin. Follow "Changing a workflow" in the same doc.
- `pnpm run setup` never re-imports an existing credential without `--refresh <id>`: it drops a Google sign-in.
- The payload contract changes in PHP (`LeadPayload`), TS (`parseLead()`), the fixture and both parity tests together (`docs/api.md`).
- Never `rm -rf .n8n-import`.

PHP and WordPress (`docs/plugin.md`, `docs/api.md`):
- `wp_remote_post()` in `WebhookClient`, never `wp_safe_remote_post()`: its SSRF guard blocks the private Docker host.
- Admin handlers check `manage_options` first (403), then the nonce. Never run list-table cell markup through `wp_kses_post()`.
- The estimate route never receives a nonce from the frontend. Neither route has an `args` schema.
- Every PHP file starts with `declare(strict_types=1);`. `src/` classes have no `ABSPATH` guard so PHPUnit can load them; `moving-quote.php`, `templates/quote-form.php` and each `site/mu-plugins/` file start with `defined( 'ABSPATH' ) || exit;`, and `uninstall.php` with `defined( 'WP_UNINSTALL_PLUGIN' ) || exit;` (`docs/architecture.md`, "Code conventions and guardrails").
- NOTE: `apply_sync()` is not fenced on the lease; the upgrade path is in `docs/plugin.md`, "Delivery".

Tests and the stack:
- No `wp db query` in stack tests: use `sqlWp()`.
- A test outside `tests/stack/` never imports `tests/stack/lib/stack.ts`, directly or transitively (`eslint.config.ts` enforces it).
- One stack at a time: every demo binds `127.0.0.1:5678`, this one also `8080`. Run `docker compose ls` first and never stop another stack.
- Secrets live only in `.env` and n8n credentials. Test emails use `example.com`; names are invented.

## Conventions

- Node 24, ESM, strict TypeScript (`docs/architecture.md`, "Code conventions and guardrails" lists the flags). Scripts run as `node scripts/<name>.ts`, no `tsx`.
- CLIs call programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import them.
- PHP: PHPCS (WPCS) and PHPStan level 9, typed array shapes on every helper that touches an array. Pure classes never call WordPress.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- Everything in the repo is in English. Spanish lives only in the two `.po` files, the `{ en, es }` tables in `src/nodes/`, `setup.sh`'s Spanish copy and slugs, and `playground/blueprint.es.json`, in a neutral Colombian business register that addresses customers as *usted* (`docs/i18n.md`).
- Local tools only: point tooling at this repo's local n8n, and validate workflows with an n8n-aware tool before importing them.

## Branches and releases

`main` is released code and `develop` the integration branch; both take pull requests only, squash-merged, with CI green. CONTRIBUTING.md owns the flow, including the `release: vX.Y.Z` pull request that `release.yml` tags.

## Pointers

- `docs/architecture.md`: components, workflows node by node, data model, failure modes, scaling, security, design decisions, repository layout, "Changing a workflow", "Rules a workflow change must keep", and "Code conventions and guardrails" (secrets and credential transport).
- `docs/plugin.md`: install lifecycle, settings, Leads admin, delivery, the quote form, the site theme.
- `docs/api.md`: REST routes, the n8n webhook, admin actions, shortcodes.
- `docs/i18n.md`: translations, languages and the switcher.
- `docs/database.md`: the Postgres role, migrations, retention, backup.
- `docs/testing.md`: every suite, CI, the local stack, the command reference, Playground.
- `docs/supply-chain.md`: pnpm, Composer, image pinning, Dependabot.
- `docs/diagrams/README.md`: how to regenerate a diagram, and the diagram list.
- Diagrams: `docs/diagrams/architecture.svg`, `docs/diagrams/lead-sequence.svg`, and the other archify sources next to them (`.json` source, `.html` page, `.svg` image).
