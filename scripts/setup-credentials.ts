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

/**
 * The decrypted JSON arrives over stdin and lives only in a strict-umask temp file in the
 * container's `/tmp`, removed either way. A host file on the bind mount would fail on Linux,
 * where the runner's uid (1001) differs from n8n's (1000).
 */
export const IMPORT_SCRIPT = 'umask 077; tmp="$(mktemp)"; cat > "$tmp"; n8n import:credentials --input="$tmp"; status=$?; rm -f "$tmp"; exit $status';

/** The credential JSON travels only as `input`, never as an argument or a file. */
export function buildImportCall(toImport: readonly ImportableCredential[]): { args: string[]; input: string } {
  return { args: ['exec', '-T', 'n8n', 'sh', '-c', IMPORT_SCRIPT], input: JSON.stringify(toImport) };
}

/**
 * The (encrypted) export stays in the container's `/tmp` and is `cat`ed only on success, so a
 * partial export can't pass for a real one; n8n's progress messages go to stderr. A host file
 * would hit EPERM on Linux, where the runner (uid 1001) can't chmod n8n's (uid 1000) file.
 */
export const EXPORT_SCRIPT = 'umask 077; tmp="$(mktemp)"; n8n export:credentials --all --output="$tmp" >&2; status=$?; [ "$status" -eq 0 ] && cat "$tmp"; rm -f "$tmp"; exit $status';

function isExecError(err: unknown): err is { stdout: string; stderr: string } {
  return typeof err === 'object' && err !== null && typeof (err as { stdout?: unknown }).stdout === 'string';
}

/** From the encrypted export, never decrypted data (see `EXPORT_SCRIPT`). */
export async function existingCredentialIds(): Promise<Set<string>> {
  let stdout: string;
  try {
    ({ stdout } = await compose(['exec', '-T', 'n8n', 'sh', '-c', EXPORT_SCRIPT]));
  } catch (err) {
    // A new instance errors instead of exporting an empty list; the message can surface on
    // either stream.
    if (isExecError(err) && (/No credentials found/i.test(err.stderr) || /No credentials found/i.test(err.stdout))) return new Set();
    throw err;
  }

  let raw: { id: string }[];
  try {
    raw = JSON.parse(stdout) as { id: string }[];
  } catch {
    throw new Error('could not parse the credential listing from n8n export:credentials');
  }
  return new Set(raw.map((c) => c.id));
}

export async function setupCredentials(o: { refresh: ReadonlySet<string> }): Promise<void> {
  loadDotEnv();

  const existingIds = await existingCredentialIds();
  const { credentials, skipped } = planCredentialImport({ env: process.env, existingIds, refresh: o.refresh });

  if (credentials.length > 0) {
    const { args, input } = buildImportCall(credentials);
    await compose(args, { input });
  }

  for (const { id, reason } of skipped) {
    const name = CREDENTIALS.find((c) => c.id === id)?.name ?? id;
    console.log(`skip ${name}: ${reason}`);
  }
  for (const { id, name } of credentials) console.log(`imported ${name} (${id})`);
}

/** The flag can repeat. */
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
