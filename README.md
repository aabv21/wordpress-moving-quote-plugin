# Chivabox Movers: WordPress Moving-Quote Plugin

**Demo.** Fictional business, not client work.

A custom WordPress plugin that gives instant moving estimates, keeps every request safe in WordPress, and sends signed leads to n8n for the team sheet and emails.

## Status

The repository skeleton, the strict TypeScript toolchain, the PHP toolchain, and CI are in place. The plugin has its skeleton and its pricing engine. The WordPress form, the Docker runtime, and the n8n workflows are not built yet.

## What works now

- `npm run typecheck`, `npm run lint`, and `npm test` (2 tests) pass.
- `scripts/init-env.ts` builds `.env` from `.env.example`, filling only empty `_PASSWORD`, `_SECRET`, and `_KEY` values (skipping `GOOGLE_*`, which come from the owner's own OAuth client) with random hex, and refuses to overwrite an existing `.env`. The write is atomic: it writes a temp file at mode 0600, then renames it over `.env`, so an interrupted run never leaves a truncated file.
- `npm run php -- composer check` (PHPCS, PHPStan level 9, PHPUnit) and `npm run php -- composer audit` pass, inside a PHP 8.3 Docker image. PHPUnit runs 14 tests for `Pricing\Calculator` and `Pricing\DistanceTable`, with no WordPress bootstrap.
- `Pricing\Calculator::estimate()` computes a moving estimate (amount, range, distance) from a move type, room count, origin, destination, and extras, against the default rates and routes in `Settings\Defaults`.
- CI runs quality (typecheck, lint, test, the PHP checks, an autoloader drift check), security (gitleaks, `npm audit`, `composer audit`), and actions (actionlint, zizmor) checks on every pull request.

## Quick start

```sh
npm ci
npm run typecheck
npm run lint
npm test
node scripts/init-env.ts
npm run php -- composer install
npm run php -- composer check
```

`node scripts/init-env.ts` writes `.env` from `.env.example`. Fill in `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` by hand; every other secret is generated.

PHP runs only inside Docker: there is no local `php` or `composer`. `npm run php -- <command>` runs `<command>` in the PHP tools container.
