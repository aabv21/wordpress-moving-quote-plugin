import { execFile } from 'node:child_process';

process.loadEnvFile('.env');

/** The loaded `.env` values the stack tests drive the real Compose stack with. */
export const env = process.env;

/** Reads `env[name]`, throwing a clear error instead of returning `undefined` for a missing one. */
export function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set; run node scripts/init-env.ts first.`);
  return value;
}

/**
 * Runs `docker <args>`, optionally writing `input` to the child's stdin, and resolves with its
 * stdout. `execFile`'s own options have no `input` field (that exists only on the `*Sync`
 * functions), so `input` is written to the returned child's stdin stream by hand.
 */
function runDocker(args: string[], input?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile('docker', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error(err.message));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

/** Runs `wp <args>` inside the idle `wpcli` container, optionally piping `input` to its stdin. */
export function wp(args: string[], input?: string): Promise<string> {
  return runDocker(['compose', 'exec', '-T', 'wpcli', 'wp', ...args], input);
}

/** Runs `wp <args> --format=json` and parses the result. */
export async function wpJson<T>(args: string[]): Promise<T> {
  const stdout = await wp([...args, '--format=json']);
  return JSON.parse(stdout) as T;
}

interface WpdbRow {
  [column: string]: string | null;
}

/**
 * Runs `query` against `$wpdb` through `wp eval-file -`, passing the query as `$args[0]` over
 * stdin so it never touches the shell. Throws on `$wpdb->last_error` instead of returning a
 * silently empty result. Stack tests never use `wp db query`: the CLI image's MariaDB client
 * isn't guaranteed compatible with MySQL 8.4's wire protocol.
 */
export async function sqlWp(query: string): Promise<WpdbRow[]> {
  const script = `
<?php
global $wpdb;
$query = $args[0];
$rows = $wpdb->get_results( $query, ARRAY_A );
if ( '' !== $wpdb->last_error ) {
	fwrite( STDERR, $wpdb->last_error );
	exit( 1 );
}
echo json_encode( $rows ?: [] );
`;
  const stdout = await wp(['eval-file', '-', query], script);
  return JSON.parse(stdout) as WpdbRow[];
}

/** The prefixed leads table name, e.g. `wp_moving_quote_leads`. */
export async function table(): Promise<string> {
  const prefix = (await wp(['eval', 'echo $GLOBALS["wpdb"]->prefix;'])).trim();
  return `${prefix}moving_quote_leads`;
}

/**
 * Runs `query` as `role` against `database`, over the `postgres` container's local Unix socket
 * (no `-h`), and returns trimmed `psql -tAc` output. The official Postgres image's default
 * `pg_hba.conf` trusts local socket connections, so this never needs a password: nothing ever
 * puts `APP_DB_PASSWORD` or `N8N_DB_PASSWORD` on the `docker compose exec` command line, where
 * any local user could read it from `ps` for as long as the call runs.
 */
export async function psqlAs(role: string, database: string, query: string): Promise<string> {
  const stdout = await runDocker(['compose', 'exec', '-T', 'postgres', 'psql', '-U', role, '-d', database, '-tAc', query]);
  return stdout.trim();
}

/** Runs `query` against the app Postgres database as `$APP_DB_USER`. */
export function sqlApp(query: string): Promise<string> {
  return psqlAs(required('APP_DB_USER'), 'app', query);
}

/** Builds a full URL under the WordPress site from `path`. */
export function site(path: string): string {
  return new URL(path, required('WP_URL')).toString();
}

export interface RestResponse {
  status: number;
  json: unknown;
  headers: Headers;
}

/** Calls a WordPress REST route with a JSON body, optionally sending a nonce and/or cookies. */
export async function rest(path: string, body: unknown, opts?: { nonce?: string; cookies?: string }): Promise<RestResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.nonce !== undefined) headers['X-WP-Nonce'] = opts.nonce;
  if (opts?.cookies !== undefined) headers.Cookie = opts.cookies;
  const res = await fetch(site(`/wp-json${path}`), { method: 'POST', headers, body: JSON.stringify(body) });
  const json: unknown = await res.json();
  return { status: res.status, json, headers: res.headers };
}

/** A fresh `wp_rest` nonce, minted through WP-CLI. */
export async function restNonce(): Promise<string> {
  return (await wp(['eval', 'echo wp_create_nonce( "wp_rest" );'])).trim();
}

/** Logs in through `wp-login.php` and returns the resulting `Cookie` header value. */
export async function login(user: string, password: string): Promise<string> {
  const body = new URLSearchParams({
    log: user,
    pwd: password,
    'wp-submit': 'Log In',
    testcookie: '1',
  });
  const res = await fetch(site('/wp-login.php'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  const cookies = res.headers.getSetCookie().map((cookie) => cookie.split(';')[0]);
  if (cookies.length === 0) throw new Error(`login failed for ${user}: no cookies set (status ${String(res.status)})`);
  return cookies.join('; ');
}

/** Clears every rate-limit transient, so a test never inherits another test's counters. */
export async function resetRateLimits(): Promise<void> {
  await wp(['transient', 'delete', '--all']);
}

/** Truncates `wp-content/debug.log` inside the `wordpress` container. */
export async function clearDebugLog(): Promise<void> {
  await runDocker(['compose', 'exec', '-T', 'wordpress', 'sh', '-c', ': > /var/www/html/wp-content/debug.log']);
}

/** Lines in `wp-content/debug.log` mentioning the plugin, read from the `wordpress` container. */
export async function pluginLogLines(): Promise<string[]> {
  try {
    const stdout = await runDocker(['compose', 'exec', '-T', 'wordpress', 'cat', '/var/www/html/wp-content/debug.log']);
    return stdout.split('\n').filter((line) => /moving-quote|chivabox/i.test(line));
  } catch {
    // The file doesn't exist yet when nothing has ever logged.
    return [];
  }
}
