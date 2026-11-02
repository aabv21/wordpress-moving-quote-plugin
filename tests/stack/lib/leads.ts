import { sqlWp, table } from './stack.ts';

/** `validLead()`'s move date: today plus 30 days, formatted `YYYY-MM-DD`. */
function moveDateIn30Days(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

/**
 * Every `request_uuid` a test has minted through `validLead()` this process, across every suite
 * file sharing this module instance. A saved lead is a real delivery attempt, and cron keeps
 * retrying a pending one for hours, so a lead a test created and forgot to delete would eventually
 * reach n8n's own intake. `deleteCreatedLeads()` sweeps this whole list.
 */
const createdLeadUuids = new Set<string>();

/**
 * A valid lead submission body: an apartment move, 2 rooms, Barranquilla to Cartagena, no extras,
 * with a move date 30 days out, a fresh `submission_id`, and an empty honeypot. Every call gets
 * its own `submission_id`, so tests never collide with each other's rows unless they deliberately
 * reuse one via `overrides` — and that overridden id is tracked for cleanup too.
 */
export function validLead(overrides?: Record<string, unknown>): Record<string, unknown> {
  const lead = {
    submission_id: crypto.randomUUID(),
    move_type: 'apartment',
    rooms: 2,
    origin: 'Barranquilla',
    destination: 'Cartagena',
    extras: [],
    move_date: moveDateIn30Days(),
    name: 'Test Customer',
    phone: '570000000001',
    email: 'customer@example.com',
    consent: true,
    website: '',
    ...overrides,
  };
  createdLeadUuids.add(lead.submission_id);
  return lead;
}

/**
 * Deletes every row this process has minted a `request_uuid` for through `validLead()`, then
 * forgets them. A row that was never actually saved (a validation failure, a filled honeypot) is a
 * harmless no-op delete. Every stack file that creates leads calls this in `afterAll`.
 */
export async function deleteCreatedLeads(): Promise<void> {
  if (0 === createdLeadUuids.size) return;

  const quoted = [...createdLeadUuids].map((uuid) => `'${uuid}'`).join(',');
  await sqlWp(`DELETE FROM ${await table()} WHERE request_uuid IN (${quoted})`);
  createdLeadUuids.clear();
}

const FAR_FUTURE = 9_999_999_999;

/**
 * A row left `pending` by an earlier file or case must never become due and reach n8n (or a
 * receiver) while another case asserts something exact, like "exactly one request" or "cron moved
 * this one row". `createPendingRowParker()` gives one file its own scoped `parkPendingRows()` /
 * `restoreParkedRows()` pair, called in its own `beforeAll`/`afterAll` (and again before/after each
 * case, if cases can leave new rows pending between them).
 */
export function createPendingRowParker(): { parkPendingRows: () => Promise<void>; restoreParkedRows: () => Promise<void> } {
  // Keyed by id, holding the `next_attempt_at` a row actually held before the first time this
  // parker touched it — never overwritten on a later park, so a restore always writes back the
  // row's pre-test value, not FAR_FUTURE from an earlier park.
  const parkedOriginals = new Map<string, string>();

  return {
    async parkPendingRows(): Promise<void> {
      const pending = await sqlWp(`SELECT id, next_attempt_at FROM ${await table()} WHERE sync_status = 'pending'`);
      for (const row of pending) {
        const id = row.id;
        const nextAttemptAt = row.next_attempt_at;
        if (null == id || null == nextAttemptAt) continue;
        if (!parkedOriginals.has(id)) parkedOriginals.set(id, nextAttemptAt);
      }
      await sqlWp(`UPDATE ${await table()} SET next_attempt_at = ${String(FAR_FUTURE)} WHERE sync_status = 'pending'`);
    },

    /** Puts back every row this parker has parked, at the `next_attempt_at` it held before this parker first touched it. A row deleted since (a test's own lead) is a harmless no-op update. */
    async restoreParkedRows(): Promise<void> {
      for (const [id, nextAttemptAt] of parkedOriginals) {
        await sqlWp(`UPDATE ${await table()} SET next_attempt_at = ${nextAttemptAt} WHERE id = ${id} AND next_attempt_at = ${String(FAR_FUTURE)}`);
      }
      parkedOriginals.clear();
    },
  };
}
