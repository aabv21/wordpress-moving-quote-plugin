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
 * Skips `GOOGLE_*`: those come from the owner's OAuth client, never generated.
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
 * Atomic, because a truncated `.env` would lose `N8N_ENCRYPTION_KEY` and every n8n credential. The
 * explicit chmod covers a tmp file a crashed run left behind: `{ mode }` applies only on create.
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
 * Creates `path` at 0700 if missing and never touches an existing one. Otherwise Compose would
 * create the bind mount on first `up`, root-owned on Linux. Only `pnpm run export` uses it; no
 * credential data crosses it.
 *
 * NOTE: on a Linux host, n8n's `node` user (uid 1000) can write here only when the host uid is
 * also 1000, since bind mounts don't remap uids. Docker Desktop is unaffected.
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
