import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { signHs256 } from '../lib/jwt.ts';
import { findExecutionIdFor, summarizeProcessLeadExecution, waitForTerminalStatus } from '../lib/execution-data.ts';
import { googleCredentialsConfigured, required, sqlApp } from '../lib/stack.ts';

// Every case reaches process-lead, so the file skips once real Google credentials exist.
const skipForLiveGoogle = await googleCredentialsConfigured();
if (skipForLiveGoogle) {
  console.log('skipping process-lead decode check: a Google credential is configured in n8n (would reach the real sheet and inbox)');
}

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/lead-payload.json', 'utf8')) as Record<string, unknown>;
const TOKEN_LIFETIME_SECONDS = 300;
const PROCESS_LEAD_WORKFLOW_ID = 'cvbProcessLead01';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function buildBody(overrides: Record<string, unknown> = {}): { text: string; requestUuid: string } {
  const requestUuid = randomUUID();
  const reference = `MQ-${requestUuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const body = { ...FIXTURE, ...overrides, request_uuid: requestUuid, reference };
  return { text: JSON.stringify(body), requestUuid };
}

async function postSignedLead(text: string, requestUuid: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const claims = { jti: requestUuid, iat: now, exp: now + TOKEN_LIFETIME_SECONDS, body_sha256: sha256Hex(text) };
  const token = signHs256(claims, required('LEAD_WEBHOOK_SECRET'));
  const res = await fetch(`${required('N8N_URL')}/webhook/moving-quote/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: text,
  });
  if (res.status !== 200) throw new Error(`lead-intake answered ${String(res.status)}, expected 200`);
}

describe.skipIf(skipForLiveGoogle)('process-lead reaches Google Sheets, read-only proof', () => {
  const createdEventIds = new Set<string>();

  afterAll(async () => {
    if (createdEventIds.size === 0) return;
    const quoted = [...createdEventIds].map((id) => `'${id}'`).join(',');
    await sqlApp(`DELETE FROM processed_events WHERE event_id IN (${quoted})`);
    createdEventIds.clear();
  });

  // Failing on the missing credential proves the chain reached Sheets, not just that it ran.
  it('decodes the latest process-lead execution: Map lead ran with the right shapes, and the chain failed at Append lead row', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    await postSignedLead(text, requestUuid);

    const executionId = await findExecutionIdFor(PROCESS_LEAD_WORKFLOW_ID, requestUuid);
    const status = await waitForTerminalStatus(executionId, 20_000);
    expect(status).toBe('error');

    const summary = await summarizeProcessLeadExecution(executionId);
    expect(summary.lastNodeExecuted).toBe('Append lead row');
    expect(summary.nodesRun).toContain('Map lead');
    expect(summary.mapLeadOutput?.rowKeys).toEqual([
      'received_at',
      'reference',
      'name',
      'phone',
      'email',
      'move_date',
      'move_type',
      'rooms',
      'origin',
      'destination',
      'distance_km',
      'extras',
      'estimate_cop',
      'estimate_low_cop',
      'estimate_high_cop',
    ]);
    expect(summary.mapLeadOutput?.teamKeys).toEqual(['to', 'subject', 'text']);
    expect(summary.mapLeadOutput?.customerKeys).toEqual(['to', 'reply_to', 'subject', 'html']);
    expect(summary.appendLeadRowErrorMessage).toMatch(/cvbCredGSheets01/);
  });

  // Only the real sandbox can prove its Intl and Luxon carry Spanish locale data.
  it("writes a Spanish lead's customer email in Spanish inside n8n's own sandbox", async () => {
    const { text, requestUuid } = buildBody({ locale: 'es_CO' });
    createdEventIds.add(requestUuid);
    await postSignedLead(text, requestUuid);

    const executionId = await findExecutionIdFor(PROCESS_LEAD_WORKFLOW_ID, requestUuid);
    await waitForTerminalStatus(executionId, 20_000);
    const output = (await summarizeProcessLeadExecution(executionId)).mapLeadOutput;

    expect(output?.customerSubject).toBe('Su cotización de mudanza de Chivabox Movers');
    expect(output?.customerHtml).toContain('COP 1.197.000 – 1.463.000');
    expect(output?.customerHtml).toContain('viernes 20 de noviembre de 2026');
    // team_locale is en in CI (config.example.json), whatever the lead's language.
    expect(output?.teamSubject).toMatch(/^(New lead|Nueva solicitud) MQ-/);
  });
});
