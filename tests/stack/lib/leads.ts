import { sqlWp, table } from './stack.ts';

/** Brief case 1's move date: today plus 30 days, formatted `YYYY-MM-DD`. */
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
 * A valid lead submission body: brief case 1 (apartment, 2 rooms, Barranquilla → Cartagena, no
 * extras), with a move date 30 days out, a fresh `submission_id`, and an empty honeypot. Every
 * call gets its own `submission_id`, so tests never collide with each other's rows unless they
 * deliberately reuse one via `overrides` — and that overridden id is tracked for cleanup too.
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
