import { readdirSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS_DIR, missingEnv, missingEnvError, orderMigrations, pendingMigrations } from './db-migrate.ts';
import { listJsonFiles } from './lib/list-json-files.ts';
import { loadDotEnv, runPsql, type PsqlOptions, type PsqlResult } from './lib/runtime.ts';
import type { WorkflowJson } from './lib/workflow-types.ts';

/** What the runtime role may do, table by table: exactly what `001_runtime_role.sql` grants. */
export const RUNTIME_GRANTS: Readonly<Record<string, readonly string[]>> = {
  processed_events: ['SELECT', 'INSERT'],
};

/**
 * True only when psql failed with `message` — the denial a check expects. A statement that
 * succeeded, or psql failing for another reason (a missing role, a stopped container), is not a
 * denial, so neither can pass.
 */
export function isDenied(result: PsqlResult, message: string): boolean {
  return !result.ok && result.stderr.includes(message);
}

/** `expected` as `table:PRIVILEGE` entries, compared with `actual`: what the role lacks, and what it holds beyond the list. */
export function diffGrants(expected: Readonly<Record<string, readonly string[]>>, actual: readonly string[]): { missing: string[]; extra: string[] } {
  const want = new Set(Object.entries(expected).flatMap(([table, privileges]) => privileges.map((p) => `${table}:${p}`)));
  const have = new Set(actual);
  return {
    missing: [...want].filter((grant) => !have.has(grant)).sort(),
    extra: [...have].filter((grant) => !want.has(grant)).sort(),
  };
}

/**
 * What `ROLE_FACTS_SQL` reports about the runtime role, as problems: an attribute it holds, a role
 * it's a member of, a column-level privilege its table grants don't account for, or `TEMP` or
 * `CREATE` on `app`. An empty list means the role is as narrow as the grant list says. None of
 * these show up in `has_table_privilege`, which only sees whole-table privileges.
 */
export function roleProblems(facts: readonly string[], grants: Readonly<Record<string, readonly string[]>>): string[] {
  if (!facts.includes('role exists')) return ['the runtime role does not exist'];
  const problems: string[] = [];
  for (const fact of facts) {
    const [kind = '', subject = '', privilege = ''] = fact.split(':');
    if (kind === 'attribute') problems.push(`holds ${subject}`);
    else if (kind === 'member of') problems.push(`is a member of ${subject}`);
    // eslint-disable-next-line security/detect-object-injection -- subject is a table name Postgres reported, looked up in the fixed grant list
    else if (kind === 'column' && !(grants[subject] ?? []).includes(privilege)) problems.push(`has ${privilege} on columns of ${subject}`);
    else if (kind === 'temp on app') problems.push('has TEMP on app');
    else if (kind === 'create on app') problems.push('has CREATE on app');
  }
  return problems;
}

export interface WorkflowStatement {
  file: string;
  node: string;
  query: string;
}

function readWorkflow(path: string): WorkflowJson {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from listJsonFiles over this repo's own workflows directory, not user input
  return JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
}

/** Every Postgres node's query in `workflows`. Throws on a Postgres node that isn't a plain query, which `PROBES` couldn't run. */
export function workflowStatements(workflows: readonly { file: string; wf: WorkflowJson }[]): WorkflowStatement[] {
  return workflows.flatMap(({ file, wf }) =>
    wf.nodes
      .filter((node) => node.type === 'n8n-nodes-base.postgres')
      .map((node) => {
        const { operation, query } = node.parameters;
        if (operation !== 'executeQuery' || typeof query !== 'string') {
          throw new Error(`${file} › ${node.name}: check-db can only run an Execute Query node's own SQL`);
        }
        return { file, node: node.name, query };
      }),
  );
}

/** The highest `$n` `query` references: how many values it binds. */
export function paramCount(query: string): number {
  return Math.max(0, ...[...query.matchAll(/\$(\d+)/g)].map((match) => Number(match[1])));
}

/** `value` quoted for a psql meta-command such as `\bind`. */
export function psqlLiteral(value: string): string {
  if (value.includes('\\')) throw new Error(`${value}: a backslash would be read as an escape`);
  return `'${value.replaceAll("'", "''")}'`;
}

export interface Probe {
  file: string;
  node: string;
  params: readonly string[];
}

const PROBE_EVENT = 'check-db-probe:wordpress-lead';

/**
 * One probe per workflow statement — today, exactly one: `lead-intake`'s "Record request". The
 * whole run is rolled back, so the inserted row never persists.
 */
export const PROBES: readonly Probe[] = [{ file: 'lead-intake.json', node: 'Record request', params: [PROBE_EVENT] }];

const label = (s: { file: string; node: string }): string => `${s.file} › ${s.node}`;

/**
 * A psql script that runs every statement exactly as its workflow wrote it, with `\bind` supplying
 * the `$n` values, inside one transaction it rolls back. `\warn` names each statement on stderr
 * first, so a failure shows which node's grant is missing.
 */
export function probeScript(statements: readonly WorkflowStatement[], probes: readonly Probe[]): string {
  for (const statement of statements) {
    if (!probes.some((probe) => label(probe) === label(statement))) throw new Error(`${label(statement)} has no probe in PROBES`);
  }
  const lines = ['BEGIN;'];
  for (const probe of probes) {
    const statement = statements.find((s) => label(s) === label(probe));
    if (!statement) throw new Error(`${label(probe)} matches no Postgres node in workflows/`);
    const expected = paramCount(statement.query);
    if (probe.params.length !== expected) throw new Error(`${label(probe)} takes ${String(expected)} values, but its probe has ${String(probe.params.length)}`);
    lines.push(`\\warn ${psqlLiteral(label(probe))}`, statement.query.trim().replace(/;$/, ''), `\\bind ${probe.params.map(psqlLiteral).join(' ')} \\g /dev/null`);
  }
  lines.push('ROLLBACK;');
  return `${lines.join('\n')}\n`;
}

/** Every privilege the runtime role holds on a table or sequence in `public`, as `name:PRIVILEGE`. */
const GRANTS_SQL = `\\getenv runtime_role APP_RUNTIME_DB_USER
SELECT c.relname || ':' || p.privilege
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) AS p(privilege)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_table_privilege(:'runtime_role', c.oid, p.privilege)
UNION ALL
SELECT c.relname || ':' || p.privilege
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) AS p(privilege)
WHERE n.nspname = 'public' AND c.relkind = 'S'
  AND has_sequence_privilege(:'runtime_role', c.oid, p.privilege)
ORDER BY 1;
`;

/** Facts about the runtime role that `roleProblems` judges: its attributes, memberships, column privileges, and `TEMP` on `app`. */
const ROLE_FACTS_SQL = `\\getenv runtime_role APP_RUNTIME_DB_USER
SELECT 'role exists' FROM pg_roles WHERE rolname = :'runtime_role'
UNION ALL
SELECT 'attribute:' || a.name
FROM pg_roles r
CROSS JOIN LATERAL (VALUES ('SUPERUSER', r.rolsuper), ('CREATEDB', r.rolcreatedb), ('CREATEROLE', r.rolcreaterole),
  ('REPLICATION', r.rolreplication), ('BYPASSRLS', r.rolbypassrls)) AS a(name, held)
WHERE r.rolname = :'runtime_role' AND a.held
UNION ALL
SELECT 'member of:' || m.roleid::regrole::text
FROM pg_auth_members m
JOIN pg_roles r ON r.oid = m.member
WHERE r.rolname = :'runtime_role'
UNION ALL
SELECT 'column:' || c.relname || ':' || p.privilege
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilege)
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND has_any_column_privilege(:'runtime_role', c.oid, p.privilege)
UNION ALL
SELECT 'temp on app' WHERE has_database_privilege(:'runtime_role', 'app', 'TEMP')
UNION ALL
SELECT 'create on app' WHERE has_database_privilege(:'runtime_role', 'app', 'CREATE');
`;

interface Outcome {
  ok: boolean;
  detail?: string;
}

interface Check {
  name: string;
  run: () => Promise<Outcome>;
}

const asRuntime = (database: 'app' | 'n8n'): PsqlOptions => ({ role: 'APP_RUNTIME_DB_USER', database, forwardEnv: ['APP_RUNTIME_DB_USER', 'APP_DB_USER'], singleTransaction: false });
const AS_SUPERUSER: PsqlOptions = { role: 'POSTGRES_USER', database: 'app', forwardEnv: ['APP_RUNTIME_DB_USER'], singleTransaction: false };
const lines = (text: string): string[] => text.split('\n').filter(Boolean);
const lastLines = (text: string): string => lines(text).slice(-3).join(' | ');

function denial(name: string, database: 'app' | 'n8n', sql: string, message: string): Check {
  return {
    name,
    run: async () => {
      const result = await runPsql(asRuntime(database), sql);
      if (isDenied(result, message)) return { ok: true };
      return { ok: false, detail: result.ok ? 'it succeeded' : lastLines(result.stderr) };
    },
  };
}

/** The real tables in RUNTIME_GRANTS, for the DROP/TRUNCATE denial checks. */
const RUNTIME_TABLES = Object.keys(RUNTIME_GRANTS);

function checks(statements: readonly WorkflowStatement[], migrationFiles: readonly string[]): Check[] {
  return [
    denial('CREATE TABLE is denied', 'app', 'BEGIN;\nCREATE TABLE check_db_probe (id int);\nROLLBACK;\n', 'permission denied for schema public'),
    ...RUNTIME_TABLES.flatMap((table) => [
      denial(`DROP TABLE ${table} is denied`, 'app', `BEGIN;\nDROP TABLE ${table};\nROLLBACK;\n`, `must be owner of table ${table}`),
      denial(`TRUNCATE ${table} is denied`, 'app', `BEGIN;\nTRUNCATE ${table};\nROLLBACK;\n`, `permission denied for table ${table}`),
    ]),
    denial('connecting to the n8n database is denied', 'n8n', 'SELECT 1;\n', 'permission denied for database "n8n"'),
    denial('SET ROLE to the owner is denied', 'app', '\\getenv owner APP_DB_USER\nSET ROLE :"owner";\n', 'permission denied to set role'),
    {
      name: 'no role attribute, membership, column grant, or TEMP/CREATE on app beyond the grant list',
      run: async () => {
        const result = await runPsql(AS_SUPERUSER, ROLE_FACTS_SQL);
        if (!result.ok) return { ok: false, detail: lastLines(result.stderr) };
        const problems = roleProblems(lines(result.stdout), RUNTIME_GRANTS);
        return problems.length === 0 ? { ok: true } : { ok: false, detail: problems.join('; ') };
      },
    },
    {
      name: 'table and sequence privileges are exactly the grant list',
      run: async () => {
        const result = await runPsql(AS_SUPERUSER, GRANTS_SQL);
        if (!result.ok) return { ok: false, detail: lastLines(result.stderr) };
        const { missing, extra } = diffGrants(RUNTIME_GRANTS, lines(result.stdout));
        if (missing.length === 0 && extra.length === 0) return { ok: true };
        return { ok: false, detail: [missing.length > 0 ? `missing ${missing.join(', ')}` : '', extra.length > 0 ? `extra ${extra.join(', ')}` : ''].filter(Boolean).join('; ') };
      },
    },
    {
      name: `every workflow Postgres statement runs (${String(statements.length)}, rolled back)`,
      run: async () => {
        const result = await runPsql(asRuntime('app'), probeScript(statements, PROBES));
        return result.ok ? { ok: true } : { ok: false, detail: lastLines(result.stderr) };
      },
    },
    {
      name: `schema_migrations lists every file in ${MIGRATIONS_DIR}`,
      run: async () => {
        const result = await runPsql({ ...AS_SUPERUSER, forwardEnv: [] }, 'SELECT filename FROM schema_migrations ORDER BY filename;\n');
        if (!result.ok) return { ok: false, detail: lastLines(result.stderr) };
        const unapplied = pendingMigrations(migrationFiles, new Set(lines(result.stdout)));
        return unapplied.length === 0 ? { ok: true } : { ok: false, detail: `not applied: ${unapplied.join(', ')}` };
      },
    },
  ];
}

async function main(): Promise<void> {
  loadDotEnv();
  const missing = missingEnv(['APP_RUNTIME_DB_USER', 'APP_DB_USER'], process.env);
  if (missing.length > 0) throw missingEnvError('check-db', missing);

  const statements = workflowStatements(listJsonFiles('workflows').map((path) => ({ file: basename(path), wf: readWorkflow(path) })));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- MIGRATIONS_DIR is this repo's own fixed directory
  const migrationFiles = orderMigrations(readdirSync(MIGRATIONS_DIR));

  let failed = 0;
  for (const check of checks(statements, migrationFiles)) {
    const { ok, detail } = await check.run();
    console.log(ok ? `ok    ${check.name}` : `FAIL  ${check.name}: ${detail ?? ''}`);
    if (!ok) failed++;
  }
  if (failed > 0) throw new Error(`${String(failed)} database check(s) failed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
