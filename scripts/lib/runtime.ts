import { compose } from './compose.ts';

export { loadDotEnv } from './compose.ts';

export interface PsqlOptions {
  /** The environment variable holding the role to connect as, expanded inside the container. */
  role: 'POSTGRES_USER' | 'APP_RUNTIME_DB_USER';
  database: 'app' | 'n8n';
  /** Variables the script reads with `\getenv`, forwarded by name from this process's environment. */
  forwardEnv: readonly string[];
  singleTransaction: boolean;
}

/**
 * The `compose()` arguments that run psql inside the `postgres` container over its local socket,
 * reading the script from stdin. Each variable in `forwardEnv` is passed as a bare `-e NAME`, so
 * Docker copies its value from this process's environment (`.env`, once `loadDotEnv` has run):
 * the value never appears in an argument list, and a changed `.env` takes effect without
 * recreating the container. psql stops at the first error and prints tuples only, unaligned.
 */
export function psqlArgs({ role, database, forwardEnv, singleTransaction }: PsqlOptions): string[] {
  const transaction = singleTransaction ? ' --single-transaction' : '';
  const psql = `psql -X -q -A -t -v ON_ERROR_STOP=1${transaction} -U "$${role}" -d ${database} -f -`;
  return ['exec', '-T', ...forwardEnv.flatMap((name) => ['-e', name]), 'postgres', 'sh', '-c', psql];
}

export interface PsqlResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function hasOutput(err: unknown): err is { stdout: string; stderr: string } {
  return typeof err === 'object' && err !== null && typeof (err as { stdout?: unknown }).stdout === 'string';
}

/** Runs `sql` through psql with `options`. A psql failure resolves with `ok: false` and its output, instead of throwing. */
export async function runPsql(options: PsqlOptions, sql: string): Promise<PsqlResult> {
  try {
    const { stdout, stderr } = await compose(psqlArgs(options), { input: sql });
    return { ok: true, stdout, stderr };
  } catch (err) {
    if (hasOutput(err)) return { ok: false, stdout: err.stdout, stderr: err.stderr };
    throw err;
  }
}

/** The non-empty values of every variable in `env` whose name ends in `PASSWORD`, `SECRET`, `TOKEN`, or `KEY`. */
export function secretValues(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter(([name, value]) => /(PASSWORD|SECRET|TOKEN|KEY)$/.test(name) && value !== undefined && value !== '')
    .map(([, value]) => value ?? '');
}

/** `text` with every occurrence of each secret replaced, for output that may echo a statement. */
export function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret !== '').reduce((out, secret) => out.replaceAll(secret, '[redacted]'), text);
}
