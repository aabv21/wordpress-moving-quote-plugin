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
- `plugin/moving-quote/` — the WordPress plugin (PHP, namespace `Chivabox\MovingQuote`), with `moving-quote.php` (the main file), `composer.json`, the committed `vendor/` (the generated Composer autoloader), and `src/Pricing/`, `src/Settings/` (pure classes).
- `compose.yaml` — the full local stack: `db` (MySQL), `wordpress`, `wpcli` (idle, for one-off commands), `cron` (the WP-Cron loop sidecar), `postgres`, `n8n`, and `php` (the tools image). See "The local stack" below.
- `db/schema.sql`, `db/init/01-app.sh` — the app Postgres database schema (table `processed_events`, for n8n idempotency) and the one-time role/database bootstrap script.
- `config/config.example.json` — the n8n runtime config template; a developer's own `config/config.json` is gitignored.
- `setup.sh` — installs and configures WordPress idempotently against the running stack. See "The local stack" below.
- `scripts/lib/docker.ts` — a small `docker compose` wrapper (`compose(args, input?)`) for TypeScript tooling.
- `vitest.stack.config.ts`, `tests/stack/` — the stack-test harness (`tests/stack/lib/stack.ts`, `tests/stack/global-setup.ts`) and tests (`tests/stack/wp/`, `tests/stack/n8n/`) that drive the real Compose stack over HTTP and WP-CLI. See "The local stack" below.

Planned, added in later tasks:

- More `plugin/moving-quote/src/` namespaces: `Leads`, `Delivery`, `Admin`, `Install`.
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
- **`setup.sh`** requires `docker compose up -d --wait` to have already run. It waits for MySQL to actually accept TCP connections (its health status can turn healthy before the real server does), then installs WordPress (admin password read from `.env` over stdin, never as an argument), sets the site description, timezone, and pretty permalinks, activates the default theme and the `moving-quote` plugin, and creates the `home`, `get-a-quote`, and `thank-you` pages. It's idempotent: running it again touches nothing that's already correct.
- **Stack tests never use `wp db query`.** The `wpcli` image's bundled MariaDB client isn't guaranteed compatible with MySQL 8.4's wire protocol. `tests/stack/lib/stack.ts`'s `sqlWp()` instead runs `wp eval-file -`, which executes PHP through WordPress's own `$wpdb`, the same client the plugin itself uses at runtime.

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit` — there is no build step.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo will be generated: the compiled frontend asset and Code-node `jsCode`.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- Local shell note: if `npm` is aliased to another package manager on your machine, run `command npm` to reach the real npm.
- PHP: every file starts with `declare(strict_types=1);`. Class files under `plugin/moving-quote/src/` hold only declarations, with no `ABSPATH` guard, so PHPUnit loads them without WordPress; files that run code when loaded (`moving-quote.php`) start with `defined( 'ABSPATH' ) || exit;`. Pure classes (`Pricing\*`, `Settings\Defaults`, …) never call a WordPress function. PHPStan runs at level 9 with typed array shapes (`@param array{…}`, `@return iterable<string, array{…}>`) on every helper and data provider that touches an array.

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
