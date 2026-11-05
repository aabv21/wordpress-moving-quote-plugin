import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decodeVerified } from '../lib/jwt.ts';
import { createPendingRowParker, deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { startReceiver, type Receiver } from '../lib/receiver.ts';
import { clearDebugLog, disableDelivery, pluginLogLines, required, resetRateLimits, rest, restNonce, sqlWp, table, wp } from '../lib/stack.ts';

const LEADS_PATH = '/moving-quote/v1/leads';
const OPTION_NAME = 'moving_quote_settings';
const PRODUCTION_WEBHOOK_URL = 'http://n8n:5678/webhook/moving-quote/leads';
const CRON_HOOK = 'moving_quote_process_outbox';

interface LeadRow {
  id: string;
  sync_status: string;
  attempts: string;
  next_attempt_at: string;
  last_error: string;
  sent_at: string | null;
}

async function rowByUuid(requestUuid: string): Promise<LeadRow> {
  const rows = await sqlWp(`SELECT id, sync_status, attempts, next_attempt_at, last_error, sent_at FROM ${await table()} WHERE request_uuid = '${requestUuid}'`);
  const row = rows[0];
  if (row === undefined) throw new Error(`no lead row found for request_uuid ${requestUuid}`);
  return row as unknown as LeadRow;
}

async function rowById(id: string): Promise<LeadRow> {
  const rows = await sqlWp(`SELECT id, sync_status, attempts, next_attempt_at, last_error, sent_at FROM ${await table()} WHERE id = ${id}`);
  const row = rows[0];
  if (row === undefined) throw new Error(`no lead row found for id ${id}`);
  return row as unknown as LeadRow;
}

/** Pass a small distinct `nextAttemptAt` to order it against another due row. */
async function forceDue(requestUuid: string, nextAttemptAt = 0): Promise<void> {
  await sqlWp(`UPDATE ${await table()} SET next_attempt_at = ${String(nextAttemptAt)} WHERE request_uuid = '${requestUuid}'`);
}

const { parkPendingRows, restoreParkedRows } = createPendingRowParker();

async function runOutboxCron(): Promise<void> {
  await wp(['cron', 'event', 'run', CRON_HOOK]);
}

/** Filtered by `request_uuid`, ignoring any unrelated delivery. */
function requestsFor(receiver: Receiver, requestUuid: string): { headers: Record<string, string>; body: string }[] {
  return receiver.requests.filter((request) => (JSON.parse(request.body) as { request_uuid?: string }).request_uuid === requestUuid);
}

function bearerToken(request: { headers: Record<string, string> }): string {
  const authorization = request.headers.authorization;
  expect(authorization).toMatch(/^Bearer .+$/);
  return (authorization ?? '').slice('Bearer '.length);
}

describe('signed delivery and the outbox', () => {
  let receiver: Receiver;
  let nonce: string;
  let secret: string;

  beforeAll(async () => {
    secret = required('LEAD_WEBHOOK_SECRET');
    nonce = await restNonce();
    await clearDebugLog();

    // No other pending row may reach the receiver during an "exactly one request" case.
    await parkPendingRows();

    receiver = await startReceiver();
    await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', receiver.url]);
  });

  afterAll(async () => {
    await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', PRODUCTION_WEBHOOK_URL]);
    await receiver.close();
    await deleteCreatedLeads();
    await restoreParkedRows();
  });

  beforeEach(async () => {
    await resetRateLimits();
    receiver.reply(200, '{"status":"accepted"}');
  });

  afterEach(async () => {
    // So a later case, or the restarted cron, never delivers this lead again.
    await parkPendingRows();
  });

  it('delivers an accepted lead inline: signed, one POST, stored as sent', async () => {
    const lead = validLead();
    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);

    const requestUuid = lead.submission_id as string;
    const requests = requestsFor(receiver, requestUuid);
    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (undefined === request) throw new Error('unreachable: length already asserted to be 1');

    const decoded = decodeVerified(bearerToken(request), secret);
    expect(decoded).not.toBeNull();
    const { header, claims } = decoded as { header: unknown; claims: unknown };
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });

    const body = JSON.parse(request.body) as Record<string, unknown>;
    const typedClaims = claims as { jti: string; iat: number; exp: number; body_sha256: string };
    expect(typedClaims.jti).toBe(body.request_uuid);
    expect(typedClaims.exp - typedClaims.iat).toBe(300);

    const { createHash } = await import('node:crypto');
    expect(typedClaims.body_sha256).toBe(createHash('sha256').update(request.body).digest('hex'));

    expect(Object.keys(body)).toEqual(['request_uuid', 'reference', 'submitted_at', 'site_name', 'team_email', 'locale', 'customer', 'move', 'estimate']);
    // determine_locale() at submit time: the stack's site language.
    expect(body.locale).toBe('en_US');

    const row = await rowByUuid(requestUuid);
    expect(row.sync_status).toBe('sent');
    expect(row.attempts).toBe('1');
    expect(row.sent_at).not.toBeNull();
    expect(row.last_error).toBe('');
  });

  it('a 503 is stored pending with backoff, then a later acceptance on retry marks it sent', async () => {
    receiver.reply(503, '');
    const lead = validLead();
    // Before the call: PHP read time() for the backoff before the slow Docker execs that follow.
    const beforeAttempt = Math.floor(Date.now() / 1000);
    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);

    const requestUuid = lead.submission_id as string;
    const afterFirstAttempt = await rowByUuid(requestUuid);
    expect(afterFirstAttempt.sync_status).toBe('pending');
    expect(afterFirstAttempt.attempts).toBe('1');
    expect(afterFirstAttempt.last_error).toMatch(/^HTTP 503/);

    const delaySeconds = Number(afterFirstAttempt.next_attempt_at) - beforeAttempt;
    expect(delaySeconds).toBeGreaterThanOrEqual(55);
    expect(delaySeconds).toBeLessThanOrEqual(65);

    const firstRequests = requestsFor(receiver, requestUuid);
    expect(firstRequests).toHaveLength(1);
    const firstRequest = firstRequests[0];
    if (undefined === firstRequest) throw new Error('unreachable: length already asserted to be 1');
    const firstClaims = decodeVerified(bearerToken(firstRequest), secret)?.claims as { jti: string; iat: number };

    receiver.reply(200, '{"status":"accepted"}');
    await forceDue(requestUuid);
    await runOutboxCron();

    const afterRetry = await rowByUuid(requestUuid);
    expect(afterRetry.sync_status).toBe('sent');
    expect(afterRetry.attempts).toBe('2');

    const retryRequests = requestsFor(receiver, requestUuid);
    expect(retryRequests).toHaveLength(2);
    const secondRequest = retryRequests[1];
    if (undefined === secondRequest) throw new Error('unreachable: length already asserted to be 2');
    const secondClaims = decodeVerified(bearerToken(secondRequest), secret)?.claims as { jti: string; iat: number };

    expect(secondClaims.jti).toBe(firstClaims.jti);
    expect(secondClaims.iat).toBeGreaterThanOrEqual(firstClaims.iat);
  });

  it('a 200 that is not acknowledged is stored pending with the unexpected-response error', async () => {
    receiver.reply(200, '<html>ok</html>');
    const lead = validLead();
    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);

    const row = await rowByUuid(lead.submission_id as string);
    expect(row.sync_status).toBe('pending');
    expect(row.last_error).toMatch(/^Unexpected response \(HTTP 200\)/);
  });

  it('a 3xx is not followed and is stored pending with the HTTP error', async () => {
    receiver.reply(302, '', { Location: 'http://unreachable.invalid/elsewhere' });
    const lead = validLead();
    const requestUuid = lead.submission_id as string;
    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);

    const row = await rowByUuid(requestUuid);
    expect(row.sync_status).toBe('pending');
    expect(row.last_error).toMatch(/^HTTP 302/);
    // redirection: 0 means the client never follows the Location header: only the one POST lands.
    expect(requestsFor(receiver, requestUuid)).toHaveLength(1);
  });

  it('an unreachable host is stored pending with the cURL error', async () => {
    await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', 'http://unreachable.invalid/lead']);
    try {
      const lead = validLead();
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(201);

      const row = await rowByUuid(lead.submission_id as string);
      expect(row.sync_status).toBe('pending');
      expect(row.last_error).toContain('cURL error 6');
    } finally {
      await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', receiver.url]);
    }
  });

  it('an empty webhook URL turns delivery off: no request sent, and cron leaves the row untouched', async () => {
    await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', '']);
    try {
      const lead = validLead();
      const requestUuid = lead.submission_id as string;
      const res = await rest(LEADS_PATH, lead, { nonce });
      expect(res.status).toBe(201);

      // Forced due, or the insert-time lease alone would keep cron away and pass this case.
      await forceDue(requestUuid);
      await runOutboxCron();

      expect(requestsFor(receiver, requestUuid)).toHaveLength(0);
      const row = await rowByUuid(requestUuid);
      expect(row.attempts).toBe('0');
    } finally {
      await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_url', receiver.url]);
    }
  });

  it('a poisoned row never blocks the rest of the batch', async () => {
    // Still pending when cron runs, or a batch that stops at the poison row would pass by accident.
    receiver.reply(503, '');
    const good = validLead();
    const goodRes = await rest(LEADS_PATH, good, { nonce });
    expect(goodRes.status).toBe(201);
    const goodUuid = good.submission_id as string;
    expect((await rowByUuid(goodUuid)).sync_status).toBe('pending');

    const bad = validLead();
    const badRes = await rest(LEADS_PATH, bad, { nonce });
    expect(badRes.status).toBe(201);
    const badUuid = bad.submission_id as string;

    // An unknown lifecycle `status` (not `sync_status`) makes from_row() throw while due() still
    // matches. The poison row sorts first (0 before 1), so a batch that stops there leaves the
    // good row pending.
    await sqlWp(`UPDATE ${await table()} SET status = 'bogus', sync_status = 'pending', attempts = 0, next_attempt_at = 0, sent_at = NULL WHERE request_uuid = '${badUuid}'`);
    await forceDue(goodUuid, 1);

    const beforeRetry = Math.floor(Date.now() / 1000);
    receiver.reply(200, '{"status":"accepted"}');
    const result = await wp(['cron', 'event', 'run', CRON_HOOK]);
    expect(result).not.toContain('Error');

    expect(requestsFor(receiver, goodUuid)).toHaveLength(2);
    const goodRow = await rowByUuid(goodUuid);
    expect(goodRow.sync_status).toBe('sent');
    expect(goodRow.attempts).toBe('2');

    const badRow = await rowByUuid(badUuid);
    expect(badRow.sync_status).toBe('pending');
    expect(badRow.attempts).toBe('1');
    expect(badRow.last_error).toMatch(/^Internal error: ValueError/);
    const delaySeconds = Number(badRow.next_attempt_at) - beforeRetry;
    expect(delaySeconds).toBeGreaterThanOrEqual(55);
    expect(delaySeconds).toBeLessThanOrEqual(65);

    await sqlWp(`DELETE FROM ${await table()} WHERE request_uuid IN ('${goodUuid}', '${badUuid}')`);
  });
});

/** The caller must turn delivery off; this doesn't. */
async function insertLead(): Promise<{ requestUuid: string; row: LeadRow }> {
  const lead = validLead();
  const nonce = await restNonce();
  const res = await rest(LEADS_PATH, lead, { nonce });
  expect(res.status).toBe(201);

  const requestUuid = lead.submission_id as string;
  return { requestUuid, row: await rowByUuid(requestUuid) };
}

describe('claim() and apply_sync() guard against a stale worker', () => {
  let restoreDelivery: () => Promise<void>;

  // Off, so the inline attempt never races the direct claim()/apply_sync() calls.
  beforeAll(async () => {
    restoreDelivery = await disableDelivery();
  });
  afterAll(async () => {
    await restoreDelivery();
  });

  beforeEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await deleteCreatedLeads();
  });

  it('claim() succeeds once, fails on the same stale expected value, and fails on a sent row', async () => {
    const { requestUuid } = await insertLead();
    // Due, so the expected value never equals the lease (a same-value UPDATE reports 0 rows).
    await forceDue(requestUuid);
    const row = await rowByUuid(requestUuid);
    const expected = Number(row.next_attempt_at);

    const script = `
<?php
use Chivabox\\MovingQuote\\Leads\\LeadRepository;
$repository = new LeadRepository();
$id       = (int) $args[0];
$expected = (int) $args[1];
$first  = $repository->claim( $id, $expected, time() + 120 );
$second = $repository->claim( $id, $expected, time() + 240 );
echo json_encode( [ 'first' => $first, 'second' => $second ] );
`;
    const out = await wp(['eval-file', '-', row.id, String(expected)], script);
    const { first, second } = JSON.parse(out) as { first: boolean; second: boolean };
    expect(first).toBe(true);
    expect(second).toBe(false);

    // Read back: it holds PHP's time(), which this process never observes.
    const claimedRow = await rowById(row.id);
    await sqlWp(`UPDATE ${await table()} SET sync_status = 'sent' WHERE id = ${row.id}`);
    const sentScript = `
<?php
use Chivabox\\MovingQuote\\Leads\\LeadRepository;
$repository = new LeadRepository();
echo json_encode( [ 'claimed' => $repository->claim( (int) $args[0], (int) $args[1], (int) $args[1] + 1000 ) ] );
`;
    // A fixed offset, not time() + 120: a same-second collision would pass for the wrong reason.
    const sentOut = await wp(['eval-file', '-', row.id, claimedRow.next_attempt_at], sentScript);
    const { claimed } = JSON.parse(sentOut) as { claimed: boolean };
    expect(claimed).toBe(false);

    await sqlWp(`DELETE FROM ${await table()} WHERE id = ${row.id}`);
  });

  it('apply_sync() never overwrites a row that has since been marked sent', async () => {
    const { row } = await insertLead();

    await sqlWp(`UPDATE ${await table()} SET sync_status = 'sent', attempts = 1, sent_at = '2026-01-01 00:00:00' WHERE id = ${row.id}`);

    const script = `
<?php
use Chivabox\\MovingQuote\\Delivery\\SyncUpdate;
use Chivabox\\MovingQuote\\Leads\\{LeadRepository, SyncStatus};
$repository = new LeadRepository();
// A stale worker's failure, which must never overwrite a row another worker marked sent.
$update = new SyncUpdate( SyncStatus::Pending, 9, time() + 60, "a stale worker's late failure", null );
$repository->apply_sync( (int) $args[0], $update );
`;
    await wp(['eval-file', '-', row.id], script);

    const after = await rowById(row.id);
    expect(after.sync_status).toBe('sent');
    expect(after.attempts).toBe('1');
    expect(after.sent_at).toBe('2026-01-01 00:00:00');

    await sqlWp(`DELETE FROM ${await table()} WHERE id = ${row.id}`);
  });

  it('deliver() catches its own internal failures and still counts the attempt', async () => {
    const { row } = await insertLead();

    const beforeAttempt = Math.floor(Date.now() / 1000);
    const script = `
<?php
use Chivabox\\MovingQuote\\Delivery\\Outbox;
use Chivabox\\MovingQuote\\Leads\\LeadRepository;
$repository = new LeadRepository();
$lead = $repository->find( (int) $args[0] );
if ( null === $lead ) {
	fwrite( STDERR, "row not found\\n" );
	exit( 1 );
}
// Invalid UTF-8 makes LeadPayload::body() throw before any HTTP call.
$corrupted = new ( $lead::class )(
	$lead->id, $lead->request_uuid, $lead->created_at, $lead->status, $lead->move_type, $lead->rooms,
	$lead->origin_city, $lead->destination_city, $lead->distance_km, $lead->move_date, $lead->extras,
	"Test \\xB1\\x31 Customer", $lead->phone, $lead->email, $lead->consent_at, $lead->estimate_cop,
	$lead->estimate_low_cop, $lead->estimate_high_cop, $lead->sync_status, $lead->attempts,
	$lead->next_attempt_at, $lead->last_error, $lead->sent_at
);
$update = Outbox::deliver( $corrupted );
echo json_encode( [ 'status' => $update->status->value, 'last_error' => $update->last_error ] );
`;
    const out = await wp(['eval-file', '-', row.id], script);
    const { status, last_error: lastError } = JSON.parse(out) as { status: string; last_error: string };
    expect(status).toBe('pending');
    expect(lastError).toMatch(/^Internal error: JsonException/);

    const after = await rowById(row.id);
    expect(after.sync_status).toBe('pending');
    expect(after.attempts).toBe('1');
    const delaySeconds = Number(after.next_attempt_at) - beforeAttempt;
    expect(delaySeconds).toBeGreaterThanOrEqual(55);
    expect(delaySeconds).toBeLessThanOrEqual(65);

    await sqlWp(`DELETE FROM ${await table()} WHERE id = ${row.id}`);
  });
});

// Last, so it covers every case in this file.
it('logs nothing from the plugin', async () => {
  await expect(pluginLogLines()).resolves.toEqual([]);
});
