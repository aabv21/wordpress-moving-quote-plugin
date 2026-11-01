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

Planned, added in later tasks:

- `plugin/moving-quote/` — the WordPress plugin itself (PHP, namespace `Chivabox\MovingQuote`), with `src/` (pure classes), `templates/`, `assets/` (generated frontend JS), and `vendor/` (the generated Composer autoloader).
- `src/frontend/` — the three-step quote form, written in TypeScript and compiled into `plugin/moving-quote/assets/`.
- `src/nodes/` — Code-node sources for the n8n workflows.
- `workflows/` — the n8n workflow JSON, mounted read-only into n8n.
- `config/config.example.json` — the n8n runtime config template; a developer's own `config/config.json` is gitignored.
- `compose.yaml` — the local runtime: WordPress, MySQL, Postgres, and n8n in Docker Compose.
- `docs/architecture.md`, `docs/diagrams/` — how the system works, with diagrams.

## Commands

- `npm ci` — install dependencies from the lockfile.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run lint` — `eslint .`.
- `npm test` — `vitest run`.
- `node scripts/init-env.ts` — writes `.env` from `.env.example`, filling empty `_PASSWORD`, `_SECRET`, and `_KEY` values with random hex (skipping `GOOGLE_*`, which come from the owner's own OAuth client). Refuses to run if `.env` already exists.

## Conventions

- Node 24 (`"engines": { "node": ">=24" }`), ESM (`"type": "module"`). `tsconfig.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit` — there is no build step.
- No `.js` or `.mjs` source files. Scripts are `scripts/*.ts`, run directly with `node scripts/<name>.ts` (Node's native type stripping; no `tsx`). Tests are Vitest files at `tests/**/*.test.ts`. The only JavaScript in the repo will be generated: the compiled frontend asset and Code-node `jsCode`.
- CLIs call external programs with `execFile` or `spawn` and an argument array, never a shell string, and guard their entry point so tests can import their functions without side effects.
- Comments only where intent isn't obvious. A deliberate simplification gets one `NOTE:` line naming its ceiling and upgrade path.
- Local shell note: if `npm` is aliased to another package manager on your machine, run `command npm` to reach the real npm.

## Guardrails

- Secrets live only in `.env` (gitignored) and n8n credentials — never in code, workflow JSON, or committed config. `scripts/init-env.ts` never prints a secret.
- Test data: emails use `example.com`; phone numbers use the prefix `5700000000`; customer names are invented. Everything in the repo is in English.
- Generated files (the compiled frontend asset, the Composer autoloader, each Code node's `jsCode`) are committed, and CI fails when they drift. Never edit them by hand.
- Point tooling only at this repo's local n8n instance, never another instance. Validate workflows with an n8n-aware validation tool before importing them.
- **PR protocol.** Branch `task-NN-<slug>` from `main`. The implementer only commits; the controller pushes, opens the PR (summary, verification, review record), waits for green CI, then squash-merges.

## Definition of done

- `npm run typecheck && npm run lint && npm test` all pass locally — run this full gate before every commit that touches TypeScript.
- No secrets anywhere in the diff or git history; `.env` and `config/config.json` are never committed.
- `README.md` (Status, What works now, and the quick start if commands changed) and this file are updated to match what the change actually adds.
- Commits follow Conventional Commits, on a branch named `task-NN-<slug>`.

## PR checklist

- [ ] The gate above passes.
- [ ] Test data uses `example.com` emails and the `5700000000` phone prefix; no real person's data.
- [ ] Docs reflect the change.
- [ ] The PR description states what was verified (commands and their output) and lists any deferred live checks.
- [ ] The diff matches its task's brief — nothing extra, nothing missing.
