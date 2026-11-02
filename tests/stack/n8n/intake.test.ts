import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { signHs256 } from '../lib/jwt.ts';
import { findExecutionIdFor } from '../lib/execution-data.ts';
import { googleCredentialsConfigured, psqlAs, required, sqlApp } from '../lib/stack.ts';

const LEAD_INTAKE_WORKFLOW_ID = 'cvbLeadIntake001';

const execFileAsync = promisify(execFile);

// A case whose post gets `accepted` hands the lead to `process-lead` fire-and-forget. Once Google
// is wired in, that would append a test row to the real sheet and email the real team on every
// run of this file — so those specific cases skip instead, the same way end-to-end.test.ts does.
const skipForLiveGoogle = await googleCredentialsConfigured();
if (skipForLiveGoogle) {
  console.log('skipping accepted-lead cases in intake.test.ts: a Google credential is configured in n8n (would reach the real sheet and inbox)');
}

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/lead-payload.json', 'utf8')) as Record<string, unknown>;
const TOKEN_LIFETIME_SECONDS = 300;
const CONFIG_PATH = 'config/config.json';
const CONFIG_RENAMED_PATH = 'config/config.json.missing-for-test';
const CONFIG_WAIT_DEADLINE_MS = 10_000;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** A fresh, otherwise-valid lead body: its own `request_uuid` (a fresh v4 UUID by default) and the matching `reference`, everything else straight from the fixture. */
function buildBody(requestUuid: string = randomUUID()): { text: string; requestUuid: string } {
  const reference = `MQ-${requestUuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const body = { ...FIXTURE, request_uuid: requestUuid, reference };
  return { text: JSON.stringify(body), requestUuid };
}

/** Signs `bodyText` into the exact claim shape WordPress sends: `jti` = its own `request_uuid` unless overridden, `iat`/`exp` a fresh 300 s window, `body_sha256` bound to `bodyText` unless overridden. */
function signBody(bodyText: string, requestUuid: string, secret: string, overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims = { jti: requestUuid, iat: now, exp: now + TOKEN_LIFETIME_SECONDS, body_sha256: sha256Hex(bodyText), ...overrides };
  return signHs256(claims, secret);
}

interface PostResult {
  status: number;
  /** Parsed JSON for a response the workflow itself sent; the raw text for the Webhook node's own plain-text 401/403 (no execution ever started). */
  json: unknown;
}

function isJsonContentType(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json');
}

async function postLead(bodyText: string, token?: string): Promise<PostResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof token === 'string') headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${required('N8N_URL')}/webhook/moving-quote/leads`, { method: 'POST', headers, body: bodyText });
  const text = await res.text();
  if (text === '') return { status: res.status, json: undefined };
  const json: unknown = isJsonContentType(res) ? JSON.parse(text) : text;
  return { status: res.status, json };
}

async function processedCount(requestUuid: string): Promise<number> {
  return Number(await sqlApp(`SELECT count(*) FROM processed_events WHERE event_id = '${requestUuid}'`));
}

/**
 * IDs of every currently running `n8n-worker` container, discovered through the queue-mode
 * override file directly (so this works whether or not the stack was brought up with it on the
 * command line). Empty when queue mode isn't active — the override declares the service, but
 * `--scale n8n-worker=0` or a regular-mode `up` leaves none running.
 */
async function runningWorkerContainerIds(): Promise<string[]> {
  const { stdout } = await execFileAsync('docker', ['compose', '-f', 'compose.yaml', '-f', 'compose.queue.yaml', 'ps', '-q', 'n8n-worker']);
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/** Whether `/files/config/config.json` currently exists inside the given container's own view of the bind mount (not the host's). `target` is a service name for `docker compose exec`, or a container id for a scaled replica `docker exec` reaches directly. */
async function configVisibleInContainer(target: string, byContainerId: boolean): Promise<boolean> {
  try {
    if (byContainerId) await execFileAsync('docker', ['exec', target, 'test', '-e', '/files/config/config.json']);
    else await execFileAsync('docker', ['compose', 'exec', '-T', target, 'test', '-e', '/files/config/config.json']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls every container that runs executions — `n8n`, plus every running `n8n-worker` replica —
 * until all of them agree on `expected`, or throws once `deadlineMs` elapses. In queue mode,
 * executions run on the workers, not on `n8n` itself, so the missing-config case would otherwise
 * race: `n8n` could see the renamed file disappear well before a worker's own view catches up,
 * and a lead sent in that gap would still find the file on the worker that picks it up.
 */
async function waitForConfigVisibility(expected: boolean, deadlineMs: number): Promise<void> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const workerIds = await runningWorkerContainerIds();
    const checks = [configVisibleInContainer('n8n', false), ...workerIds.map((id) => configVisibleInContainer(id, true))];
    const results = await Promise.all(checks);
    if (results.every((visible) => visible === expected)) return;
    if (Date.now() >= deadline) throw new Error(`config.json did not become ${expected ? 'visible' : 'invisible'} to n8n and every running n8n-worker container within ${String(deadlineMs)} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface ExecutionState {
  status: string;
  deletedAt: string | null;
}

async function readExecutionState(executionId: number): Promise<ExecutionState> {
  const row = await psqlAs(
    required('N8N_DB_USER'),
    'n8n',
    `SELECT status || '|' || coalesce("deletedAt"::text, '') FROM execution_entity WHERE id = ${String(executionId)}`,
  );
  const [status, deletedAt] = row.split('|') as [string, string];
  return { status, deletedAt: deletedAt === '' ? null : deletedAt };
}

/**
 * Polls (read-only) until `execution_entity`'s `deletedAt` for this execution is set and backdated
 * past the hard-delete buffer (n8n's 1 h default), proving the run is a successful one n8n has
 * already marked for its next hard-delete purge — or until `deadlineMs` elapses, throwing with the
 * last state seen. Never writes to n8n's own tables: that purge is n8n's own job, run on its own
 * schedule (every 15 min by default), and this file never shortcuts it.
 */
async function waitForSoftDelete(executionId: number, deadlineMs: number): Promise<ExecutionState> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const state = await readExecutionState(executionId);
    const backdated = await psqlAs(
      required('N8N_DB_USER'),
      'n8n',
      `SELECT ("deletedAt" IS NOT NULL AND "deletedAt" <= now() - interval '1 hour')::text FROM execution_entity WHERE id = ${String(executionId)}`,
    );
    if (backdated === 'true') return state;
    if (Date.now() >= deadline) throw new Error(`execution ${String(executionId)} was not soft-deleted within ${String(deadlineMs)} ms (last state: ${JSON.stringify(state)})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('lead intake webhook', () => {
  let secret: string;
  const createdEventIds = new Set<string>();

  beforeAll(() => {
    secret = required('LEAD_WEBHOOK_SECRET');
  });

  afterEach(async () => {
    if (createdEventIds.size === 0) return;
    const quoted = [...createdEventIds].map((id) => `'${id}'`).join(',');
    await sqlApp(`DELETE FROM processed_events WHERE event_id IN (${quoted})`);
    createdEventIds.clear();
  });

  it.skipIf(skipForLiveGoogle)('accepts a validly signed lead and records it once', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const token = signBody(text, requestUuid, secret);

    const res = await postLead(text, token);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: 'accepted' });
    expect(await processedCount(requestUuid)).toBe(1);
  });

  // NOTE: n8n 2.45.6 stores the raw `Authorization` header verbatim in `execution_data` for every
  // outcome of this workflow, with no redaction. An accepted/duplicate/401/422-rejected run all
  // succeed at the workflow level, so `saveDataSuccessExecution: 'none'` applies and
  // `deleteInFlightExecution()` soft-deletes the row — with pruning on, that only backdates
  // `deletedAt` by the hard-delete buffer (1 h by default); `status` itself stays `running`. The
  // token is gone at the next hard-delete cycle (n8n's own pruner, every 15 min by default)
  // rather than at `EXECUTIONS_DATA_MAX_AGE`. This case asserts exactly that, read-only — never
  // deleting an n8n row itself, which is n8n's own job on its own schedule — see AGENTS.md for
  // the full mechanism and what bounds the risk in between.
  it.skipIf(skipForLiveGoogle)('a successful run is soft-deleted for the next hard-delete cycle, not kept until EXECUTIONS_DATA_MAX_AGE', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const token = signBody(text, requestUuid, secret);

    const res = await postLead(text, token);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ status: 'accepted' });

    const executionId = await findExecutionIdFor(LEAD_INTAKE_WORKFLOW_ID, requestUuid);
    const state = await waitForSoftDelete(executionId, 5_000);
    expect(state.deletedAt).not.toBeNull();
  });

  it.skipIf(skipForLiveGoogle)('answers duplicate for a replay of the same body with a fresh token, and still counts one row', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const firstToken = signBody(text, requestUuid, secret);
    const first = await postLead(text, firstToken);
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ status: 'accepted' });

    const secondToken = signBody(text, requestUuid, secret);
    const second = await postLead(text, secondToken);
    expect(second.status).toBe(200);
    expect(second.json).toEqual({ status: 'duplicate' });
    expect(await processedCount(requestUuid)).toBe(1);
  });

  // "Read config" (Read/Write Files from Disk) throws its own `No file(s)…` when `fileSelector`
  // matches nothing, failing the run before "Record request" ever runs — not a timeout or an
  // empty-output edge case, but that node's documented behavior for a selector with no match.
  it('a missing config.json fails loudly instead of answering an empty 200, and the run is kept for diagnosis', async () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
    renameSync(CONFIG_PATH, CONFIG_RENAMED_PATH);
    try {
      // A host-side rename of a bind-mounted file can trail its container-side view under rapid
      // repeated access to the same path; poll the container's own view instead of assuming a
      // fixed settle time.
      await waitForConfigVisibility(false, CONFIG_WAIT_DEADLINE_MS);

      const { text, requestUuid } = buildBody();
      createdEventIds.add(requestUuid);
      const token = signBody(text, requestUuid, secret);

      const res = await postLead(text, token);
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await processedCount(requestUuid)).toBe(0);

      const executionId = await findExecutionIdFor(LEAD_INTAKE_WORKFLOW_ID, requestUuid);
      const state = await readExecutionState(executionId);
      expect(state.status).toBe('error');
      expect(state.deletedAt).toBeNull();
    } finally {
      renameSync(CONFIG_RENAMED_PATH, CONFIG_PATH);
      await waitForConfigVisibility(true, CONFIG_WAIT_DEADLINE_MS);
    }
  });

  it('rejects a token signed with a different 64-hex secret', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const wrongSecret = 'a'.repeat(64);
    const token = signBody(text, requestUuid, wrongSecret);

    const res = await postLead(text, token);
    expect(res.status).toBe(403);
    expect(await processedCount(requestUuid)).toBe(0);
  });

  it('rejects a request with no Authorization header', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);

    const res = await postLead(text);
    expect(res.status).toBe(401);
    expect(await processedCount(requestUuid)).toBe(0);
  });

  it('rejects an expired token', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const now = Math.floor(Date.now() / 1000);
    const token = signBody(text, requestUuid, secret, { iat: now - 400, exp: now - 100 });

    const res = await postLead(text, token);
    expect(res.status).toBe(403);
  });

  it('rejects a token with alg "none" and an empty signature', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const now = Math.floor(Date.now() / 1000);
    const claims = { jti: requestUuid, iat: now, exp: now + TOKEN_LIFETIME_SECONDS, body_sha256: sha256Hex(text) };
    const headerPart = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const claimsPart = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const token = `${headerPart}.${claimsPart}.`;

    const res = await postLead(text, token);
    expect(res.status).toBe(403);
  });

  it('rejects a token with no exp claim', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const now = Math.floor(Date.now() / 1000);
    const token = signHs256({ jti: requestUuid, iat: now, body_sha256: sha256Hex(text) }, secret);

    const res = await postLead(text, token);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ status: 'rejected', reason: 'missing_claims' });
  });

  it('rejects a token whose lifetime exceeds 300 seconds', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const now = Math.floor(Date.now() / 1000);
    const token = signBody(text, requestUuid, secret, { iat: now, exp: now + 600 });

    const res = await postLead(text, token);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ status: 'rejected', reason: 'token_lifetime' });
  });

  it('rejects a body changed after signing, with no row recorded', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const token = signBody(text, requestUuid, secret);

    const tampered = JSON.parse(text) as { estimate: { amount: number } };
    tampered.estimate.amount += 1;

    const res = await postLead(JSON.stringify(tampered), token);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ status: 'rejected', reason: 'body_hash_mismatch' });
    expect(await processedCount(requestUuid)).toBe(0);
  });

  it('rejects a token whose jti does not match request_uuid', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);
    const token = signBody(text, requestUuid, secret, { jti: randomUUID() });

    const res = await postLead(text, token);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ status: 'rejected', reason: 'jti_mismatch' });
  });

  it.skipIf(skipForLiveGoogle)('five concurrent deliveries of one fresh lead give exactly one accepted and four duplicate, with one row recorded', async () => {
    const { text, requestUuid } = buildBody();
    createdEventIds.add(requestUuid);

    const results = await Promise.all(
      Array.from({ length: 5 }, async () => postLead(text, signBody(text, requestUuid, secret))),
    );

    const statuses = results.map((r) => (r.json as { status: string }).status);
    expect(statuses.filter((s) => s === 'accepted')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(4);
    expect(await processedCount(requestUuid)).toBe(1);
  });
});
