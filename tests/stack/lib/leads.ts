import { sqlWp, table } from './stack.ts';

function moveDateIn30Days(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

/**
 * A saved lead is a real delivery attempt that cron retries for hours, so `deleteCreatedLeads()`
 * sweeps every id minted here.
 */
const createdLeadUuids = new Set<string>();

/**
 * Apartment, 2 rooms, Barranquilla to Cartagena, 30 days out, a fresh `submission_id`. An id
 * passed in `overrides` is tracked for cleanup too.
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

/** A row that was never saved is a no-op delete. */
export async function deleteCreatedLeads(): Promise<void> {
  if (0 === createdLeadUuids.size) return;

  const quoted = [...createdLeadUuids].map((uuid) => `'${uuid}'`).join(',');
  await sqlWp(`DELETE FROM ${await table()} WHERE request_uuid IN (${quoted})`);
  createdLeadUuids.clear();
}

const FAR_FUTURE = 9_999_999_999;

/**
 * Keeps other `pending` rows from becoming due while a file asserts something exact, like
 * "exactly one request". Each file gets its own park/restore pair.
 */
export function createPendingRowParker(): { parkPendingRows: () => Promise<void>; restoreParkedRows: () => Promise<void> } {
  // The value before this parker first touched each row, never overwritten by a later park.
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

    /** A row deleted since is a no-op update. */
    async restoreParkedRows(): Promise<void> {
      for (const [id, nextAttemptAt] of parkedOriginals) {
        await sqlWp(`UPDATE ${await table()} SET next_attempt_at = ${nextAttemptAt} WHERE id = ${id} AND next_attempt_at = ${String(FAR_FUTURE)}`);
      }
      parkedOriginals.clear();
    },
  };
}
