# Chivabox Movers: WordPress Moving-Quote Plugin

**Demo.** Fictional business, not client work.

A custom WordPress plugin that gives instant moving estimates, keeps every request safe in WordPress, and sends signed leads to n8n for the team sheet and emails.

## Status

The repository skeleton, the strict TypeScript toolchain, and CI are in place. The plugin, the Docker runtime, and the n8n workflows are not built yet.

## What works now

- `npm run typecheck`, `npm run lint`, and `npm test` (2 tests) pass.
- `scripts/init-env.ts` builds `.env` from `.env.example`, filling only empty `_PASSWORD`, `_SECRET`, and `_KEY` values (skipping `GOOGLE_*`, which come from the owner's own OAuth client) with random hex, and refuses to overwrite an existing `.env`. The write is atomic: it writes a temp file at mode 0600, then renames it over `.env`, so an interrupted run never leaves a truncated file.
- CI runs quality (typecheck, lint, test), security (gitleaks, `npm audit`), and actions (actionlint, zizmor) checks on every pull request.

## Quick start

```sh
npm ci
npm run typecheck
npm run lint
npm test
node scripts/init-env.ts
```

`node scripts/init-env.ts` writes `.env` from `.env.example`. Fill in `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` by hand; every other secret is generated.
