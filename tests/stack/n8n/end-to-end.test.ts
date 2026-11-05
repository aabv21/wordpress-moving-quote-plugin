import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitForWebhookAuthProtected } from '../../../scripts/lib/health.ts';
import { createPendingRowParker, deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { googleCredentialsConfigured, required, resetRateLimits, rest, restNonce, sqlApp, sqlWp, table, wp } from '../lib/stack.ts';

// Every case reaches process-lead, so the file skips once real Google credentials exist.
const skipForLiveGoogle = await googleCredentialsConfigured();
if (skipForLiveGoogle) {
  console.log('skipping end-to-end delivery tests: a Google credential is configured in n8n (would reach the real sheet and inbox)');
}

const execFileAsync = promisify(execFile);

const LEADS_PATH = '/moving-quote/v1/leads';
const OPTION_NAME = 'moving_quote_settings';
const CRON_HOOK = 'moving_quote_process_outbox';

interface LeadRow {
  sync_status: string;
  attempts: string;
  last_error: string;
}

async function rowByUuid(requestUuid: string): Promise<LeadRow> {
  const rows = await sqlWp(`SELECT sync_status, attempts, last_error FROM ${await table()} WHERE request_uuid = '${requestUuid}'`);
  const row = rows[0];
  if (row === undefined) throw new Error(`no lead row found for request_uuid ${requestUuid}`);
  return row as unknown as LeadRow;
}

async function forceDue(requestUuid: string): Promise<void> {
  await sqlWp(`UPDATE ${await table()} SET next_attempt_at = 0 WHERE request_uuid = '${requestUuid}'`);
}

async function runOutboxCron(): Promise<void> {
  await wp(['cron', 'event', 'run', CRON_HOOK]);
}

const { parkPendingRows, restoreParkedRows } = createPendingRowParker();

/** For deleting each one's `processed_events` row in `afterAll`. */
const deliveredRequestUuids = new Set<string>();

async function deleteProcessedEvents(): Promise<void> {
  if (0 === deliveredRequestUuids.size) return;
  const quoted = [...deliveredRequestUuids].map((id) => `'${id}'`).join(',');
  await sqlApp(`DELETE FROM processed_events WHERE event_id IN (${quoted})`);
  deliveredRequestUuids.clear();
}

describe.skipIf(skipForLiveGoogle)('end-to-end delivery through the real n8n instance', () => {
  let nonce: string;

  beforeAll(async () => {
    nonce = await restNonce();
    // No other pending row may reach n8n while this file asserts exact attempts.
    await parkPendingRows();
  });

  afterAll(async () => {
    await deleteProcessedEvents();
    await deleteCreatedLeads();
    await restoreParkedRows();
  });

  it('a submitted lead is sent and recorded once', async () => {
    await resetRateLimits();
    const lead = validLead();
    const requestUuid = lead.submission_id as string;
    deliveredRequestUuids.add(requestUuid);

    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);

    const row = await rowByUuid(requestUuid);
    expect(row.sync_status).toBe('sent');
    expect(row.attempts).toBe('1');

    const count = await sqlApp(`SELECT count(*) FROM processed_events WHERE event_id = '${requestUuid}'`);
    expect(count).toBe('1');
  });

  it(
    'while n8n is stopped, the lead stays pending with a cURL connection error, then a retry after n8n restarts marks it sent',
    async () => {
      await resetRateLimits();
      const lead = validLead();
      const requestUuid = lead.submission_id as string;
      deliveredRequestUuids.add(requestUuid);

      let live: boolean;
      try {
        await execFileAsync('docker', ['compose', 'stop', 'n8n']);

        const res = await rest(LEADS_PATH, lead, { nonce });
        expect(res.status).toBe(201);

        const afterStop = await rowByUuid(requestUuid);
        expect(afterStop.sync_status).toBe('pending');
        expect(afterStop.attempts).toBe('1');
        expect(afterStop.last_error).toMatch(/cURL error (6|7)/);
      } finally {
        // Restore unconditionally; the liveness assertion runs after, so it can't mask a failure above.
        await execFileAsync('docker', ['compose', 'start', 'n8n']);
        // 401 means healthy with the trigger registered: more exact than a fixed sleep.
        live = await waitForWebhookAuthProtected(required('N8N_URL'), 'moving-quote/leads', 90_000);
      }
      expect(live).toBe(true);

      await forceDue(requestUuid);
      await runOutboxCron();

      const afterRetry = await rowByUuid(requestUuid);
      expect(afterRetry.sync_status).toBe('sent');
      expect(afterRetry.attempts).toBe('2');

      const count = await sqlApp(`SELECT count(*) FROM processed_events WHERE event_id = '${requestUuid}'`);
      expect(count).toBe('1');
    },
    // Above the 90 s the restart-liveness poll alone can take, clear of the file's default 60 s testTimeout.
    120_000,
  );

  it('a wrong webhook secret makes delivery fail with HTTP 403, and restoring it lets a forced retry succeed', async () => {
    await resetRateLimits();
    const before = await wp(['option', 'get', OPTION_NAME, '--format=json']);
    const previousSecret = (JSON.parse(before) as { webhook_secret: string }).webhook_secret;
    const wrongSecret = 'f'.repeat(64);

    try {
      // Over STDIN, like setup.sh, so the secret never reaches a command line or output.
      await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_secret'], wrongSecret);

      const lead = validLead();
      const requestUuid = lead.submission_id as string;
      deliveredRequestUuids.add(requestUuid);
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(201);

      const row = await rowByUuid(requestUuid);
      expect(row.sync_status).toBe('pending');
      expect(row.last_error).toMatch(/^HTTP 403/);

      await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_secret'], previousSecret);

      await forceDue(requestUuid);
      await runOutboxCron();

      const afterRetry = await rowByUuid(requestUuid);
      expect(afterRetry.sync_status).toBe('sent');
    } finally {
      await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_secret'], previousSecret);
    }
  });

  it('redelivering an already-sent lead answers duplicate, so the row is sent again with no second processed_events row', async () => {
    await resetRateLimits();
    const lead = validLead();
    const requestUuid = lead.submission_id as string;
    deliveredRequestUuids.add(requestUuid);

    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);
    expect((await rowByUuid(requestUuid)).sync_status).toBe('sent');

    await sqlWp(`UPDATE ${await table()} SET sync_status = 'pending', next_attempt_at = 0 WHERE request_uuid = '${requestUuid}'`);
    await runOutboxCron();

    const afterRedelivery = await rowByUuid(requestUuid);
    expect(afterRedelivery.sync_status).toBe('sent');

    const count = await sqlApp(`SELECT count(*) FROM processed_events WHERE event_id = '${requestUuid}'`);
    expect(count).toBe('1');
  });
});
