import { afterEach, expect, it, vi } from 'vitest';
import { CREDENTIALS } from '../../scripts/lib/manifest.ts';

const composeMock = vi.fn<(args: readonly string[], opts?: { input?: string }) => Promise<{ stdout: string; stderr: string }>>();
vi.mock('../../scripts/lib/compose.ts', () => ({ compose: composeMock, loadDotEnv: vi.fn() }));

const { buildImportCall, EXPORT_SCRIPT, existingCredentialIds, IMPORT_SCRIPT, planCredentialImport } = await import('../../scripts/setup-credentials.ts');

afterEach(() => {
  composeMock.mockReset();
});

const env = Object.fromEntries(CREDENTIALS.flatMap((c) => c.env).map((k) => [k, `${k.toLowerCase()}-test`]));
const plan = (o: Partial<Parameters<typeof planCredentialImport>[0]>) =>
  planCredentialImport({ env, existingIds: new Set(), refresh: new Set(), ...o });

it('builds every credential with its fixed id', () => expect(plan({}).credentials.map((c) => c.id).sort()).toEqual(CREDENTIALS.map((c) => c.id).sort()));
it('shapes the JWT and Postgres data for n8n 2.45.6', () => {
  const byId = new Map(plan({}).credentials.map((c) => [c.id, c.data]));
  expect(byId.get('cvbCredLeadJwt01')).toEqual({ keyType: 'passphrase', secret: 'lead_webhook_secret-test', algorithm: 'HS256' });
  expect(byId.get('cvbCredAppDb0001')).toEqual({ host: 'postgres', port: 5432, database: 'app', user: 'app_runtime_db_user-test', password: 'app_runtime_db_password-test', ssl: 'disable' });
});
it('narrows the Gmail credential to the send-only scope, never the default GmailOAuth2Api scope list', () => {
  const byId = new Map(plan({}).credentials.map((c) => [c.id, c.data]));
  const gmailData = byId.get('cvbCredGmail0001') as Record<string, unknown>;
  expect(gmailData['customScopes']).toBe(true);
  expect(gmailData['enabledScopes']).toBe('https://www.googleapis.com/auth/gmail.send');
  // Never the broader default scopes (gmail.modify, the full mail.google.com access, …)
  // GmailOAuth2Api.credentials.js falls back to when customScopes is unset.
  expect(gmailData['enabledScopes']).not.toMatch(/gmail\.modify|mail\.google\.com/);

  // The Sheets credential is unaffected: it's a different Google service with its own (unlisted
  // here, left at n8n's own default) scope, not narrowed by this change.
  const sheetsData = byId.get('cvbCredGSheets01') as Record<string, unknown>;
  expect(sheetsData['customScopes']).toBeUndefined();
  expect(sheetsData['enabledScopes']).toBeUndefined();
});
it('every env var set skips nothing', () => expect(plan({}).skipped).toEqual([]));
it('skips credentials with missing env and names the variables', () =>
  expect(plan({ env: { APP_RUNTIME_DB_USER: 'u', APP_RUNTIME_DB_PASSWORD: 'p' } }).skipped).toContainEqual({ id: 'cvbCredLeadJwt01', reason: 'missing LEAD_WEBHOOK_SECRET' }));
it('with only the App DB vars set, imports cvbCredAppDb0001 alone', () => {
  const { credentials, skipped } = plan({ env: { APP_RUNTIME_DB_USER: 'u', APP_RUNTIME_DB_PASSWORD: 'p' } });
  expect(credentials.map((c) => c.id)).toEqual(['cvbCredAppDb0001']);
  expect(skipped).toContainEqual({ id: 'cvbCredLeadJwt01', reason: 'missing LEAD_WEBHOOK_SECRET' });
});
it('never overwrites an existing credential unless asked', () => {
  expect(plan({ existingIds: new Set(['cvbCredGSheets01']) }).skipped).toContainEqual({ id: 'cvbCredGSheets01', reason: 'exists' });
  expect(plan({ existingIds: new Set(['cvbCredGSheets01']), refresh: new Set(['cvbCredGSheets01']) }).credentials.map((c) => c.id)).toContain('cvbCredGSheets01');
});

it('buildImportCall streams the credential JSON over stdin, never as a file argument', () => {
  const toImport = [{ id: 'cvbCredAppDb0001', name: 'App DB', type: 'postgres', data: { user: 'app' } }];
  const call = buildImportCall(toImport);
  expect(call.args).toEqual(['exec', '-T', 'n8n', 'sh', '-c', IMPORT_SCRIPT]);
  expect(call.input).toBe(JSON.stringify(toImport));
  expect(call.args.join(' ')).not.toContain('credentials.json');
});

it('IMPORT_SCRIPT sets a strict umask, uses its own temp file, and cleans up on both outcomes', () => {
  expect(IMPORT_SCRIPT).toContain('umask 077');
  expect(IMPORT_SCRIPT).toContain('mktemp');
  expect(IMPORT_SCRIPT).toContain('n8n import:credentials --input="$tmp"');
  expect(IMPORT_SCRIPT).toContain('rm -f "$tmp"');
  expect(IMPORT_SCRIPT).toContain('exit $status');
});

it('EXPORT_SCRIPT sets a strict umask, uses its own temp file, sends n8n\'s own output to stderr, and only cats on success', () => {
  expect(EXPORT_SCRIPT).toContain('umask 077');
  expect(EXPORT_SCRIPT).toContain('mktemp');
  expect(EXPORT_SCRIPT).toContain('n8n export:credentials --all --output="$tmp" >&2');
  expect(EXPORT_SCRIPT).toContain('cat "$tmp"');
  expect(EXPORT_SCRIPT).toContain('rm -f "$tmp"');
  expect(EXPORT_SCRIPT).toContain('exit $status');
});

it('existingCredentialIds runs EXPORT_SCRIPT and parses the ids from stdout, never a file', async () => {
  composeMock.mockResolvedValue({ stdout: JSON.stringify([{ id: 'cvbCredAppDb0001' }, { id: 'cvbCredLeadJwt01' }]), stderr: 'Acquiring database migration lock...\nSuccessfully exported 2 credentials.' });
  const ids = await existingCredentialIds();
  expect(composeMock).toHaveBeenCalledWith(['exec', '-T', 'n8n', 'sh', '-c', EXPORT_SCRIPT]);
  expect(ids).toEqual(new Set(['cvbCredAppDb0001', 'cvbCredLeadJwt01']));
});

it('existingCredentialIds returns an empty set when n8n reports no credentials yet, on either stream', async () => {
  composeMock.mockRejectedValueOnce(Object.assign(new Error('exit 1'), { stdout: '', stderr: 'No credentials found' }));
  expect(await existingCredentialIds()).toEqual(new Set());

  composeMock.mockRejectedValueOnce(Object.assign(new Error('exit 1'), { stdout: 'No credentials found', stderr: '' }));
  expect(await existingCredentialIds()).toEqual(new Set());
});

it('existingCredentialIds rethrows any other failure', async () => {
  composeMock.mockRejectedValueOnce(Object.assign(new Error('exit 1'), { stdout: '', stderr: 'permission denied' }));
  await expect(existingCredentialIds()).rejects.toThrow('exit 1');
});

it('existingCredentialIds throws a fixed message, not the unparseable export, when stdout is not JSON', async () => {
  const corruptStdout = 'Acquiring database migration lock...\n{"id":"cvbCredAppDb0001", truncated';
  composeMock.mockResolvedValue({ stdout: corruptStdout, stderr: '' });
  await expect(existingCredentialIds()).rejects.toThrow('could not parse the credential listing from n8n export:credentials');
  await expect(existingCredentialIds()).rejects.not.toThrow(/cvbCredAppDb0001|truncated|migration lock/);
});
