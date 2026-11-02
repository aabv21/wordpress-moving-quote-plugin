import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const EXAMPLE_PATH = '.env.example';
const ENV_PATH = '.env';
const N8N_IMPORT_DIR = '.n8n-import';

function defaultRandomHex(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Fills only the empty values whose names end in `_PASSWORD`, `_SECRET`, or `_KEY`, skipping
 * names that start with `GOOGLE_` (those come from the owner's own OAuth client, never generated).
 * Comments, blank lines, and every other value are kept as-is, in order.
 */
export function fillSecrets(example: string, randomHex: () => string = defaultRandomHex): string {
  return example
    .split('\n')
    .map((line) => {
      const match = /^([A-Z0-9_]+)=$/.exec(line);
      if (!match) return line;
      const name = match[1];
      if (name === undefined) return line;
      if (name.startsWith('GOOGLE_')) return line;
      if (!/_(PASSWORD|SECRET|KEY)$/.test(name)) return line;
      return `${name}=${randomHex()}`;
    })
    .join('\n');
}

/**
 * Writes `.env` text atomically at mode 0600. `.env` holds `N8N_ENCRYPTION_KEY`; a write that's
 * interrupted partway through must never leave a truncated file, which would lose every stored
 * n8n credential. Writes to a tmp file first, then renames it over the target in one step. The
 * tmp file is chmod'd 0600 explicitly, because a crashed prior run can leave it behind at
 * whatever looser mode it was created with, and `writeFileSync`'s own `{ mode }` option only
 * applies when the file doesn't already exist.
 */
export function writeEnvFile(path: string, text: string): void {
  const tmpPath = `${path}.tmp`;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  writeFileSync(tmpPath, text, { mode: 0o600 });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  chmodSync(tmpPath, 0o600);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .env path, not user input
  renameSync(tmpPath, path);
}

/**
 * Creates `path` at mode 0700 if it doesn't exist yet, and leaves it (and whatever it already
 * holds) alone otherwise — never removed or recreated. No credential data crosses this directory:
 * `setup-credentials.ts` streams credentials into the `n8n` container over stdin and reads the
 * existing-credentials export back over stdout, entirely inside the container's own `/tmp`. The
 * directory serves only `pnpm run export` (`export-workflows.ts` writes its output under
 * `.n8n-import/export`, recreating that one subdirectory itself with `mkdirSync`, which defaults
 * to 0755); without this function, Docker Compose would instead create the bind-mounted
 * `.n8n-import/` itself on first `up`, owned by `root` on Linux, before `export-workflows.ts`
 * ever gets to create its own subdirectory under it.
 *
 * NOTE: mode 0700 only lets the n8n container's own `node` user (uid 1000) write into this
 * directory when the host's own uid running this script is also 1000 — true for the first user
 * account on most single-user Linux installs, but not guaranteed. A host uid that doesn't match
 * still leaves the directory root-owned from the n8n container's point of view (bind mounts carry
 * the host's uid numbers through as-is, with no remapping), reproducing the same problem this
 * function exists to avoid. Docker Desktop's own Linux VM sidesteps this entirely: every
 * bind-mounted file appears owned by whatever uid the container process runs as, not the macOS
 * or Windows host's own uid, so this ceiling is Linux-host-only.
 */
export function ensureN8nImportDir(path: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .n8n-import path, not user input
  if (existsSync(path)) return;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is the caller-provided .n8n-import path, not user input
  mkdirSync(path, { mode: 0o700 });
}

function main(): void {
  if (existsSync(ENV_PATH)) {
    console.error('.env already exists; delete it to regenerate.');
    process.exitCode = 1;
    return;
  }
  const example = readFileSync(EXAMPLE_PATH, 'utf8');
  writeEnvFile(ENV_PATH, fillSecrets(example));
  ensureN8nImportDir(N8N_IMPORT_DIR);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
