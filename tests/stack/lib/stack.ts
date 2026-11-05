import { execFile } from 'node:child_process';
import { existingCredentialIds } from '../../../scripts/setup-credentials.ts';
import { CREDENTIALS, googleCredentialIds } from '../../../scripts/lib/manifest.ts';

process.loadEnvFile('.env');

export const env = process.env;

export function required(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set; run node scripts/init-env.ts first.`);
  return value;
}

/** `execFile` has no `input` option (only the `*Sync` functions do), so stdin is written by hand. */
function runDocker(args: string[], input?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile('docker', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error(err.message));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

export function wp(args: string[], input?: string): Promise<string> {
  return runDocker(['compose', 'exec', '-T', 'wpcli', 'wp', ...args], input);
}

export async function wpJson<T>(args: string[]): Promise<T> {
  const stdout = await wp([...args, '--format=json']);
  return JSON.parse(stdout) as T;
}

interface WpdbRow {
  [column: string]: string | null;
}

/**
 * Through `$wpdb`, with the query over stdin, never the shell. Not `wp db query`: the image's
 * MariaDB client isn't guaranteed compatible with MySQL 8.4. Throws on `last_error`.
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

export async function table(): Promise<string> {
  const prefix = (await wp(['eval', 'echo $GLOBALS["wpdb"]->prefix;'])).trim();
  return `${prefix}moving_quote_leads`;
}

/**
 * Over the local socket, which the image's `pg_hba.conf` trusts, so no password ever reaches a
 * command line `ps` could read.
 */
export async function psqlAs(role: string, database: string, query: string): Promise<string> {
  const stdout = await runDocker(['compose', 'exec', '-T', 'postgres', 'psql', '-U', role, '-d', database, '-tAc', query]);
  return stdout.trim();
}

export function sqlApp(query: string): Promise<string> {
  return psqlAs(required('APP_DB_USER'), 'app', query);
}

export function site(path: string): string {
  return new URL(path, required('WP_URL')).toString();
}

export interface RestResponse {
  status: number;
  json: unknown;
  headers: Headers;
}

export async function rest(path: string, body: unknown, opts?: { nonce?: string; cookies?: string }): Promise<RestResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts?.nonce !== undefined) headers['X-WP-Nonce'] = opts.nonce;
  if (opts?.cookies !== undefined) headers.Cookie = opts.cookies;
  const res = await fetch(site(`/wp-json${path}`), { method: 'POST', headers, body: JSON.stringify(body) });
  const json: unknown = await res.json();
  return { status: res.status, json, headers: res.headers };
}

export async function restNonce(): Promise<string> {
  return (await wp(['eval', 'echo wp_create_nonce( "wp_rest" );'])).trim();
}

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

export async function resetRateLimits(): Promise<void> {
  await wp(['transient', 'delete', '--all']);
}

const OPTION_NAME = 'moving_quote_settings';

/**
 * Patches `webhook_url` to `''`, so no lead reaches the real n8n webhook. Call the returned restore
 * in `afterAll`.
 */
export async function disableDelivery(): Promise<() => Promise<void>> {
  const settings = await wpJson<{ webhook_url: string }>(['option', 'get', OPTION_NAME]);
  const previousUrl = settings.webhook_url;
  await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', '']);
  return async () => {
    await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', previousUrl]);
  };
}

export async function clearDebugLog(): Promise<void> {
  await runDocker(['compose', 'exec', '-T', 'wordpress', 'sh', '-c', ': > /var/www/html/wp-content/debug.log']);
}

export async function pluginLogLines(): Promise<string[]> {
  try {
    const stdout = await runDocker(['compose', 'exec', '-T', 'wordpress', 'cat', '/var/www/html/wp-content/debug.log']);
    return stdout.split('\n').filter((line) => /moving-quote|chivabox/i.test(line));
  } catch {
    // The file doesn't exist yet when nothing has ever logged.
    return [];
  }
}

/**
 * Checked like `setup-credentials.ts` does, from an export of ids, never decrypted data. A test
 * reaching `process-lead` skips once true, or it would write to the real sheet and inboxes.
 */
export async function googleCredentialsConfigured(): Promise<boolean> {
  const ids = await existingCredentialIds();
  return googleCredentialIds(CREDENTIALS).some((id) => ids.has(id));
}
