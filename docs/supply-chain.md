# Supply-chain hardening

pnpm is pinned in `package.json`'s `packageManager` to an exact `11.x`; never move to pnpm 12 (Dependabot can't yet parse its two-document lockfile). `pnpm-workspace.yaml` holds the settings pnpm 11 no longer reads from `.npmrc`:

- `minimumReleaseAge: 4320`: no version (transitive included) younger than 3 days, so a compromised release can be caught first.
- `minimumReleaseAgeExclude: []`: overrides pnpm 11's default `n8n`/`n8n-*`/`@n8n/*` exemption; nothing is exempt.
- `trustPolicy: no-downgrade`: fails when a package's provenance or trusted-publishing evidence regresses, or the pinned pnpm would downgrade it. Exceptions live in `trustPolicyExclude`.
- `blockExoticSubdeps: true`: only a direct dependency may come from a git or tarball URL.
- `strictDepBuilds: true`, `dangerouslyAllowAllBuilds: false`: an install script fails unless approved in `allowBuilds`.
- `engineStrict: true`: a dependency whose `engines` excludes this Node fails the install.
- `allowBuilds`: only packages a real `pnpm install --frozen-lockfile` proved need a build, each with a one-line reason (`esbuild`, which re-links its platform binary). Add one only after the same proof.

`tests/supply-chain.test.ts` reads these back through `pnpm config list --json`, so a misspelled or ignored key fails. It also checks the `packageManager` shape, that `package-lock.json` is absent, that no tracked file teaches `npm` or `npx`, digest pins on every image (Compose, `docker run` in CI, the PHP Dockerfile), and, on the merged Compose config, `no-new-privileges` on every long-running service with `cap_drop: ALL` on `n8n` and `n8n-worker` only (the other images switch users at startup and need capabilities not yet proven safe to drop). See `docs/testing.md`.

**`trustPolicyExclude` holds three owner-approved exceptions**, transitive dependencies of `@wp-playground/cli` (through `@wp-playground/storage` → `octokit`, one also through `@octokit/app`) pulled in only by `pnpm dlx`, never `pnpm-lock.yaml`:

- `@octokit/endpoint@9.0.6`: a 2025-02-14 security backport on an old line, without provenance.
- `@octokit/plugin-paginate-rest@9.2.2`: a 2025-02-15 backport on the 9.x line, which never had provenance.
- `@octokit/webhooks@12.3.2`: a 2025-07-11 backport on an old line, without provenance.

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

- `policy.advisories.block: true`: `update`/`require`/`remove` refuse a version with a known advisory. A plain `install` from the lock isn't blocked; `composer audit --locked` covers that.
- `policy.abandoned.block: false` with `policy.abandoned.audit: "fail"`: an abandoned package installs, but `composer audit` fails CI.
- `policy.cooldown.period: "3 days"`: mirrors pnpm's `minimumReleaseAge` for `update`/`require`.
- `allow-plugins` lists only the installed plugins (`phpstan/extension-installer`, `dealerdirect/phpcodesniffer-composer-installer`).
- `minimum-stability: "stable"` with `prefer-stable: true`.

`tests/supply-chain.test.ts` asserts every value above, that `allow-plugins` is an object, and that no `config.audit` key exists.

**Verifying the Composer policy:** `pnpm run php composer validate --strict`, `pnpm run php composer install` (if the lock won't resolve under the cooldown, wait; never loosen the policy), and `pnpm run php composer audit --locked --abandoned=fail`. CI's `quality` job runs `validate --strict`, `install`, `audit --locked --abandoned=fail`, `lint`, `analyse`, and `test`.

**Updating a PHP dependency:** edit `composer.json`, run `pnpm run php composer update <package>`, run the verification above, and commit `composer.json` and `composer.lock` together. For an urgent fix inside the cooldown, add a scoped, dated `policy.cooldown.ignore` entry and remove it after 3 days.

**The PHP image** is digest-pinned like the Compose images. After any change, `docker compose build php`, then rerun `pnpm run php composer check` and `pnpm run php composer audit`.

**Playground** runs through `pnpm dlx @wp-playground/cli@3.1.61`, not `npx`, so the same release-age gate and trust policy apply.

## What the tests check

Part of the same `pnpm test` run (`tests/supply-chain.test.ts`), checking the settings that keep a dependency or a CI step from running unpinned or unreviewed code, against the real, effective config rather than just the text that sets it:

- **pnpm.** `pnpm config list --json` (not just `pnpm-workspace.yaml`'s text, so a misspelled or ignored key fails here) carries `minimumReleaseAge` of at least 4,320 minutes (3 days) with `minimumReleaseAgeExclude` emptied out (pnpm 11 ships a built-in n8n exemption this repo overrides), `trustPolicy: no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds`, and `engineStrict` all on, and `dangerouslyAllowAllBuilds` off; `trustPolicyExclude` holds exactly the three owner-approved `@octokit/*` pins (an exact `name@version` each, never a bare name); `package.json`'s `packageManager` pins an exact `pnpm@11.x.y`; `package-lock.json` doesn't exist; and no tracked file (other than the test itself) still teaches any `npm` or `npx` subcommand, since this repo's own pnpm alias convention replaces all of them.
- **Docker image pinning.** Every `image:` line in `compose.yaml` and `compose.queue.yaml`, and every `FROM`/`COPY --from` line in `docker/php/Dockerfile`, is pinned by `@sha256:` digest; so is every `docker run` image reference across every file in `.github/workflows/`.
- **Container hardening.** Reading the merged, effective Compose config (`docker compose … config --format json`, not the raw YAML, so `n8n-worker`'s settings inherited through `extends` are checked too): every long-running service (`db`, `wordpress`, `wpcli`, `cron`, `postgres`, `n8n`, `redis`, `n8n-worker`) sets `security_opt: no-new-privileges:true` (the one-shot `php` tools container is excluded); only `n8n` and `n8n-worker` drop every Linux capability (`cap_drop: ALL`); the other services switch users internally at startup and need a capability this repo hasn't proven safe to drop per image yet.
- **Composer policy.** `composer.json`'s `config.policy.advisories.block` and `config.policy.abandoned.audit` are both set to fail the build on an insecure or abandoned package; its cooldown period is at least 3 days; there's no deprecated `config.audit` key; `config.allow-plugins` is an object (never a bare `true`) listing only installed plugins; and `minimum-stability`/`prefer-stable` keep the project on stable releases.
- **zizmor.** `.github/workflows/ci.yml` installs it with `pip install --require-hashes -r .github/zizmor-requirements.txt`, and that requirements file pins `zizmor==1.31.1` with at least one `--hash=sha256:…` line.

`pnpm audit` reports one moderate advisory, GHSA-g3hv-75wg-m249 in minimatch, reached only through eslint (development only). CI fails on high and above, so it passes; revisit when eslint depends on minimatch 11.0.1 or later.

**Staying deterministic and clean:** every check reads real config (pnpm's own effective settings, the merged Compose config, the committed `composer.json`/workflow files) rather than re-asserting a copy of a value, so a change to the underlying setting is what the test actually verifies, not a restatement of it.

## Bumped by hand

The `wordpress` and `wordpress:cli` images and Polylang (`setup.sh`'s `polylang_version`) are not updated automatically. Dependabot ignores them on purpose (see `.github/dependabot.yml`). Check their changelogs on the first working day of each month.
