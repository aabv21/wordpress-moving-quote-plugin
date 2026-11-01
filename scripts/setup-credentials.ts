import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compose, loadDotEnv } from './lib/compose.ts';
import { CREDENTIALS } from './lib/manifest.ts';

export interface ImportableCredential {
  id: string;
  name: string;
  type: string;
  data: Record<string, unknown>;
}

export function planCredentialImport(o: {
  env: Record<string, string | undefined>;
  existingIds: ReadonlySet<string>;
  refresh: ReadonlySet<string>;
}): { credentials: ImportableCredential[]; skipped: { id: string; reason: string }[] } {
  const credentials: ImportableCredential[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const entry of CREDENTIALS) {
    const scoped: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of entry.env) {
      // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed `env` list, not user input
      const value = o.env[key];
      // eslint-disable-next-line security/detect-object-injection -- key comes from this entry's own fixed `env` list, not user input
      if (value) scoped[key] = value;
      else missing.push(key);
    }
    if (missing.length > 0) {
      skipped.push({ id: entry.id, reason: `missing ${missing.join(', ')}` });
      continue;
    }

    // Re-importing a credential replaces it, which drops an interactive Google sign-in. Skip an
    // existing credential unless it was explicitly asked to be refreshed.
    if (o.existingIds.has(entry.id) && !o.refresh.has(entry.id)) {
      skipped.push({ id: entry.id, reason: 'exists' });
      continue;
    }

    credentials.push({ id: entry.id, name: entry.name, type: entry.type, data: entry.data(scoped) });
  }

  return { credentials, skipped };
}

const IMPORT_DIR = '.n8n-import';
const CREDENTIALS_FILE = `${IMPORT_DIR}/credentials.json`;
const EXISTING_FILE_NAME = 'existing-credentials.json';
const EXISTING_FILE = `${IMPORT_DIR}/${EXISTING_FILE_NAME}`;

function isExecError(err: unknown): err is { stdout: string } {
  return typeof err === 'object' && err !== null && typeof (err as { stdout?: unknown }).stdout === 'string';
}

/**
 * IDs already in n8n, read from an (encrypted) CLI export — never the decrypted credential data.
 * Exported to a file rather than read from stdout: the CLI prints its own "Acquiring database
 * migration lock..." line to stdout ahead of the JSON payload, which would otherwise break
 * JSON.parse.
 */
async function existingCredentialIds(): Promise<Set<string>> {
  try {
    await compose(['exec', '-T', 'n8n', 'n8n', 'export:credentials', '--all', `--output=/import/${EXISTING_FILE_NAME}`]);
  } catch (err) {
    // A brand-new instance with no credentials yet errors instead of exporting an empty list.
    if (isExecError(err) && /No credentials found/i.test(err.stdout)) return new Set();
    throw err;
  }

  chmodSync(EXISTING_FILE, 0o600);
  try {
    const raw = JSON.parse(readFileSync(EXISTING_FILE, 'utf8')) as { id: string }[];
    return new Set(raw.map((c) => c.id));
  } finally {
    rmSync(EXISTING_FILE, { force: true });
  }
}

export async function setupCredentials(o: { refresh: ReadonlySet<string> }): Promise<void> {
  loadDotEnv();
  mkdirSync(IMPORT_DIR, { recursive: true });

  const existingIds = await existingCredentialIds();
  const { credentials, skipped } = planCredentialImport({ env: process.env, existingIds, refresh: o.refresh });

  if (credentials.length > 0) {
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    chmodSync(CREDENTIALS_FILE, 0o600);
    try {
      await compose(['exec', '-T', 'n8n', 'n8n', 'import:credentials', '--input=/import/credentials.json']);
    } finally {
      rmSync(CREDENTIALS_FILE, { force: true });
    }
  }

  for (const { id, reason } of skipped) {
    const name = CREDENTIALS.find((c) => c.id === id)?.name ?? id;
    console.log(`skip ${name} (${id}): ${reason}`);
  }
  for (const { id, name } of credentials) console.log(`imported ${name} (${id})`);
}

/** Every value following a `--refresh` flag, in order; the flag can repeat. */
export function parseRefreshIds(args: readonly string[]): Set<string> {
  const refresh = new Set<string>();
  for (const [i, arg] of args.entries()) {
    if (arg !== '--refresh') continue;
    const id = args.at(i + 1);
    if (id) refresh.add(id);
  }
  return refresh;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const refresh = parseRefreshIds(process.argv.slice(2));
  setupCredentials({ refresh }).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
