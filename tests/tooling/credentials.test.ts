import { expect, it } from 'vitest';
import { planCredentialImport } from '../../scripts/setup-credentials.ts';
import { CREDENTIALS } from '../../scripts/lib/manifest.ts';

const env = Object.fromEntries(CREDENTIALS.flatMap((c) => c.env).map((k) => [k, `${k.toLowerCase()}-test`]));
const plan = (o: Partial<Parameters<typeof planCredentialImport>[0]>) =>
  planCredentialImport({ env, existingIds: new Set(), refresh: new Set(), ...o });

it('builds every credential with its fixed id', () => expect(plan({}).credentials.map((c) => c.id).sort()).toEqual(CREDENTIALS.map((c) => c.id).sort()));
it('shapes the JWT and Postgres data for n8n 2.45.6', () => {
  const byId = new Map(plan({}).credentials.map((c) => [c.id, c.data]));
  expect(byId.get('cvbCredLeadJwt01')).toEqual({ keyType: 'passphrase', secret: 'lead_webhook_secret-test', algorithm: 'HS256' });
  expect(byId.get('cvbCredAppDb0001')).toEqual({ host: 'postgres', port: 5432, database: 'app', user: 'app_db_user-test', password: 'app_db_password-test', ssl: 'disable' });
});
it('every env var set skips nothing', () => expect(plan({}).skipped).toEqual([]));
it('skips credentials with missing env and names the variables', () =>
  expect(plan({ env: { APP_DB_USER: 'u', APP_DB_PASSWORD: 'p' } }).skipped).toContainEqual({ id: 'cvbCredLeadJwt01', reason: 'missing LEAD_WEBHOOK_SECRET' }));
it('with only the App DB vars set, imports cvbCredAppDb0001 alone', () => {
  const { credentials, skipped } = plan({ env: { APP_DB_USER: 'u', APP_DB_PASSWORD: 'p' } });
  expect(credentials.map((c) => c.id)).toEqual(['cvbCredAppDb0001']);
  expect(skipped).toContainEqual({ id: 'cvbCredLeadJwt01', reason: 'missing LEAD_WEBHOOK_SECRET' });
});
it('never overwrites an existing credential unless asked', () => {
  expect(plan({ existingIds: new Set(['cvbCredGSheets01']) }).skipped).toContainEqual({ id: 'cvbCredGSheets01', reason: 'exists' });
  expect(plan({ existingIds: new Set(['cvbCredGSheets01']), refresh: new Set(['cvbCredGSheets01']) }).credentials.map((c) => c.id)).toContain('cvbCredGSheets01');
});
