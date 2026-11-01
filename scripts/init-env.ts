import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const EXAMPLE_PATH = '.env.example';
const ENV_PATH = '.env';

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

function main(): void {
  if (existsSync(ENV_PATH)) {
    console.error('.env already exists; delete it to regenerate.');
    process.exitCode = 1;
    return;
  }
  const example = readFileSync(EXAMPLE_PATH, 'utf8');
  writeEnvFile(ENV_PATH, fillSecrets(example));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
