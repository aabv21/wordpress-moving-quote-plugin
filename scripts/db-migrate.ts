import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv, redact, runPsql, secretValues } from './lib/runtime.ts';

export const MIGRATIONS_DIR = 'db/migrations';

/** `NNN_short_name.sql`: a three-digit sequence number, then a lowercase name. */
const MIGRATION_NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

/** psql's `\getenv psql_variable ENV_NAME`, the only way a migration reads `.env`. */
const GETENV = /^\\getenv[ \t]+\w+[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*$/gm;

/**
 * Runs before anything else, every time: creates the ledger of applied files (as the owner role,
 * so `app` owns it, not the superuser) and lists what it holds.
 */
export const BOOTSTRAP_SQL = `\\getenv owner APP_DB_USER
SET LOCAL ROLE :"owner";
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SELECT filename FROM schema_migrations ORDER BY filename;
`;

/**
 * Runs after the migrations, every time: `setup-credentials` rebuilds n8n's app credential from
 * `.env` on every run, so the role's password must follow `.env` on every run too, or a changed
 * value would lock n8n out. psql quotes the value itself; it never reaches an argument list.
 *
 * Postgres logs a failed statement's full text by default (`log_min_error_statement = error`),
 * and this one carries the password, so the transaction raises that threshold first, and turns
 * statement logging off in case a server enables it. The same statement re-asserts the role's
 * attributes, so a hand-granted `CREATEDB` or `SUPERUSER` doesn't survive the next run.
 */
export const RUNTIME_PASSWORD_SQL = `SET LOCAL log_min_error_statement = panic;
SET LOCAL log_statement = 'none';
\\getenv runtime_role APP_RUNTIME_DB_USER
\\getenv runtime_password APP_RUNTIME_DB_PASSWORD
ALTER ROLE :"runtime_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';
`;

/** Any fixed key: every run takes the same transaction-scoped advisory lock, so two runs can't interleave one file. */
export const MIGRATION_LOCK_KEY = 6_420_001;

/** The variables naming the other roles, which the runtime role must never share a name with. */
const OTHER_ROLE_NAMES = ['POSTGRES_USER', 'N8N_DB_USER', 'APP_DB_USER'] as const;

/** The `.sql` files in `fileNames`, in sequence order. Throws on a misnamed file or a reused sequence number. */
export function orderMigrations(fileNames: readonly string[]): string[] {
  const files = fileNames.filter((name) => name.endsWith('.sql')).sort();
  const seen = new Map<string, string>();
  for (const file of files) {
    const sequence = MIGRATION_NAME.exec(file)?.[1];
    if (sequence === undefined) throw new Error(`${MIGRATIONS_DIR}/${file}: name it like 001_short_name.sql`);
    const other = seen.get(sequence);
    if (other !== undefined) throw new Error(`${MIGRATIONS_DIR}: ${other} and ${file} share ${sequence}; renumber one`);
    seen.set(sequence, file);
  }
  return files;
}

/** The files in `files` not yet in `applied`, in order. */
export function pendingMigrations(files: readonly string[], applied: ReadonlySet<string>): string[] {
  return files.filter((file) => !applied.has(file));
}

/** Every environment variable `sql` reads with `\getenv`, once each, in order. */
export function requiredEnv(sql: string): string[] {
  return [...new Set([...sql.matchAll(GETENV)].map((match) => match[1] ?? ''))];
}

/** The names in `names` that `env` leaves unset or empty. Compose turns an unset name into an empty one, so both count. */
export function missingEnv(names: readonly string[], env: Readonly<Record<string, string | undefined>>): string[] {
  // eslint-disable-next-line security/detect-object-injection -- name comes from a migration's own \getenv line, not user input
  return names.filter((name) => !env[name]);
}

/** The error for `source` needing `missing`. It names variables only, never a value. */
export function missingEnvError(source: string, missing: readonly string[]): Error {
  const verb = missing.length === 1 ? 'is' : 'are';
  return new Error(`${source} needs ${missing.join(', ')}, which ${verb} not set in .env; see .env.example and docs/database.md`);
}

/**
 * The variables in `OTHER_ROLE_NAMES` whose value equals `APP_RUNTIME_DB_USER`'s. Sharing a name
 * would point the runtime role's grants and password at the owner or the superuser instead.
 */
export function runtimeRoleClashes(env: Readonly<Record<string, string | undefined>>): string[] {
  const runtime = env.APP_RUNTIME_DB_USER;
  // eslint-disable-next-line security/detect-object-injection -- name is one of the fixed OTHER_ROLE_NAMES
  return runtime ? OTHER_ROLE_NAMES.filter((name) => env[name] === runtime) : [];
}

/** The index just past the next `token` at or after `from`, or the end of `sql` if there is none. */
function skipPast(sql: string, token: string, from: number): number {
  const at = sql.indexOf(token, from);
  return at === -1 ? sql.length : at + token.length;
}

/**
 * `sql` with its comments, string literals, quoted identifiers, and dollar-quoted bodies blanked
 * out, and each psql meta-command (a backslash, up to the end of its line) turned into `;`, so
 * what's left splits into statements on `;`.
 */
function codeOnly(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    // A dollar-quote tag is $$ or $name$, where the name can't start with a digit (so $1 isn't one).
    const dollarMatch = /^\$[A-Za-z0-9_]*\$/.exec(rest)?.[0];
    const dollarTag = dollarMatch && !/^\$\d/.test(dollarMatch) ? dollarMatch : undefined;
    if (rest.startsWith('--')) {
      const lineEnd = sql.indexOf('\n', i);
      i = lineEnd === -1 ? sql.length : lineEnd;
      out += ' ';
    } else if (rest.startsWith('/*')) {
      i = skipPast(sql, '*/', i + 2);
      out += ' ';
    } else if (dollarTag) {
      i = skipPast(sql, dollarTag, i + dollarTag.length);
      out += ' ';
    } else if (rest.startsWith("'") || rest.startsWith('"')) {
      const quote = rest.charAt(0);
      let j = i + 1;
      for (;;) {
        j = skipPast(sql, quote, j);
        if (j >= sql.length || sql.charAt(j) !== quote) break;
        j += 1; // a doubled quote is an escaped one, so the literal goes on
      }
      i = j;
      out += ' ';
    } else if (rest.startsWith('\\')) {
      const lineEnd = sql.indexOf('\n', i);
      i = lineEnd === -1 ? sql.length : lineEnd;
      out += ';';
    } else {
      out += sql.charAt(i);
      i += 1;
    }
  }
  return out;
}

/**
 * The first transaction-control statement in `sql` (`BEGIN`, `COMMIT`, `ROLLBACK`, `ABORT`,
 * `START TRANSACTION`, or `END`), or `undefined`. A migration runs inside db-migrate's own
 * transaction, together with its ledger row, so one of these would split the two.
 */
export function transactionControl(sql: string): string | undefined {
  for (const statement of codeOnly(sql).split(';')) {
    const keyword = /^\s*(BEGIN|COMMIT|ROLLBACK|ABORT|START\s+TRANSACTION|END)\b/i.exec(statement)?.[1];
    if (keyword) return keyword.toUpperCase().replace(/\s+/, ' ');
  }
  return undefined;
}

/** The statement that records `file` as applied, appended to the file so both commit together. */
export function recordMigration(file: string): string {
  if (!MIGRATION_NAME.test(file)) throw new Error(`${file} is not a migration file name`);
  return `INSERT INTO schema_migrations (filename) VALUES ('${file}');\n`;
}

/** What one psql run sends for `file`: the advisory lock first, then the file, then its ledger row. */
export function migrationScript(file: string, sql: string): string {
  return `SELECT pg_advisory_xact_lock(${String(MIGRATION_LOCK_KEY)});\n${sql}\n${recordMigration(file)}`;
}

/** Runs `sql` as the superuser in one transaction, failing with psql's own error, redacted. */
async function apply(label: string, sql: string): Promise<string> {
  const result = await runPsql({ role: 'POSTGRES_USER', database: 'app', forwardEnv: requiredEnv(sql), singleTransaction: true }, sql);
  if (!result.ok) throw new Error(`${label} failed, and nothing in it was applied:\n${redact(result.stderr.trim(), secretValues(process.env))}`);
  return result.stdout;
}

function assertEnv(source: string, sql: string): void {
  const missing = missingEnv(requiredEnv(sql), process.env);
  if (missing.length > 0) throw missingEnvError(source, missing);
}

/** Applies every pending migration, then resets the runtime role's password and attributes. `pnpm run setup` runs this first. */
export async function dbMigrate(): Promise<void> {
  loadDotEnv();
  const files = orderMigrations(readdirSync(MIGRATIONS_DIR));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- file is a validated name read from MIGRATIONS_DIR
  const sql = new Map(files.map((file) => [file, readFileSync(join(MIGRATIONS_DIR, file), 'utf8')]));
  for (const [file, text] of sql) {
    const keyword = transactionControl(text);
    if (keyword) throw new Error(`${MIGRATIONS_DIR}/${file} contains ${keyword}; db-migrate runs each file in its own transaction`);
  }

  assertEnv('db-migrate', BOOTSTRAP_SQL + RUNTIME_PASSWORD_SQL);
  const clashes = runtimeRoleClashes(process.env);
  if (clashes.length > 0) throw new Error(`APP_RUNTIME_DB_USER must name its own role, but it matches ${clashes.join(', ')} in .env`);
  const applied = new Set((await apply('db-migrate bootstrap', BOOTSTRAP_SQL)).split('\n').filter(Boolean));
  const pending = pendingMigrations(files, applied);
  // Check every pending file before applying any, so a missing variable can't stop a run halfway.
  for (const file of pending) assertEnv(file, sql.get(file) ?? '');

  for (const file of pending) {
    await apply(file, migrationScript(file, sql.get(file) ?? ''));
    console.log(`applied ${file}`);
  }
  if (pending.length === 0) console.log('no pending migrations');

  await apply('setting the runtime role password', RUNTIME_PASSWORD_SQL);
  console.log('runtime role password set from APP_RUNTIME_DB_PASSWORD');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  dbMigrate().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
