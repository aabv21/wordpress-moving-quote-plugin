import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { disableDelivery, resetRateLimits, restNonce, rest, sqlWp, table, wp } from '../lib/stack.ts';

const LEADS_PATH = '/moving-quote/v1/leads';

/** The customer-facing reference `LeadRecord::reference()` builds: `MQ-` plus the first 8 hex of the UUID, uppercased. */
function referenceFor(requestUuid: string): string {
  return `MQ-${requestUuid.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

interface ExporterResult {
  done: boolean;
  data: Array<{ group_id: string; item_id: string; data: Array<{ name: string; value: string }> }>;
}

interface EraserResult {
  done: boolean;
  items_removed: boolean;
  items_retained: boolean;
  messages: string[];
}

/**
 * Calls the exporter/eraser the way WordPress core's own Tools → Export/Erase Personal Data
 * screens would: through `apply_filters('wp_privacy_personal_data_exporters'|'erasers', [])`,
 * which exercises `Admin\PersonalData::register()`'s own registration (already wired into
 * `Plugin::boot()`, so it's live on every real request) instead of calling
 * `Admin\PersonalData::export()`/`::erase()` by name and skipping that step. Finds this plugin's
 * entry by its own registered key (`moving-quote-leads`) among whatever else is registered, then
 * invokes its `callback`. Driving the full core request lifecycle needs an emailed confirmation
 * link, which has no place in an automated test; this still proves registration and the callback
 * both work, which is the part this plugin owns.
 */
async function callPersonalData<T>(kind: 'exporters' | 'erasers', email: string): Promise<T> {
  const script = `
<?php
$email = $args[0];
$registered = apply_filters( 'wp_privacy_personal_data_${kind}', [] );
if ( ! isset( $registered['moving-quote-leads'] ) ) {
	fwrite( STDERR, 'moving-quote-leads not registered among: ' . implode( ', ', array_keys( $registered ) ) );
	exit( 1 );
}
$callback = $registered['moving-quote-leads']['callback'];
$result = $callback( $email );
echo json_encode( $result );
`;
  const stdout = await wp(['eval-file', '-', email], script);
  return JSON.parse(stdout) as T;
}

async function exportFor(email: string): Promise<ExporterResult> {
  return callPersonalData<ExporterResult>('exporters', email);
}

async function eraseFor(email: string): Promise<EraserResult> {
  return callPersonalData<EraserResult>('erasers', email);
}

describe('personal data: export and erase', () => {
  let nonce: string;
  let restoreDelivery: () => Promise<void>;

  beforeAll(async () => {
    restoreDelivery = await disableDelivery();
    await resetRateLimits();
    nonce = await restNonce();
  });
  afterAll(async () => {
    await restoreDelivery();
    await deleteCreatedLeads();
  });

  it('exports every field of a matching lead through the registered exporter filter, and reports nothing for an email with no leads', async () => {
    const email = `privacy-export-${crypto.randomUUID()}@example.com`;
    const lead = validLead({ email, name: 'Privacy Export Test', extras: ['packing', 'storage'] });
    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);

    const exported = await exportFor(email);
    expect(exported.done).toBe(true);
    expect(exported.data).toHaveLength(1);
    const fields = exported.data[0]!.data;
    const fieldNames = fields.map((field) => field.name);

    expect(fields).toContainEqual({ name: 'Email', value: email });
    expect(fields).toContainEqual({ name: 'Name', value: 'Privacy Export Test' });
    expect(fields).toContainEqual({ name: 'Status', value: 'New' });
    expect(fields).toContainEqual({ name: 'Extras', value: 'packing, storage' });
    expect(fields).toContainEqual({ name: 'Distance (km)', value: '120' });
    // packing (200,000) + storage (300,000) on top of the apartment/2-room/Barranquilla-Cartagena
    // base (1,130,000) gives 1,630,000, ±10% range_percent rounded to the nearest 1,000 COP.
    expect(fields).toContainEqual({ name: 'Estimate amount (COP)', value: '1630000' });
    expect(fields).toContainEqual({ name: 'Estimate low (COP)', value: '1467000' });
    expect(fields).toContainEqual({ name: 'Estimate high (COP)', value: '1793000' });
    expect(fieldNames.some((name) => name === 'Reference')).toBe(true);
    expect(fieldNames.some((name) => name.startsWith('Submitted'))).toBe(true);
    expect(fieldNames.some((name) => name.startsWith('Consent given'))).toBe(true);

    const empty = await exportFor(`no-such-lead-${crypto.randomUUID()}@example.com`);
    expect(empty.done).toBe(true);
    expect(empty.data).toHaveLength(0);
  });

  it('exports every lead sharing one email, newest first', async () => {
    const email = `privacy-export-multi-${crypto.randomUUID()}@example.com`;
    const first = validLead({ email, name: 'First Lead' });
    const second = validLead({ email, name: 'Second Lead' });
    expect((await rest(LEADS_PATH, first, { nonce })).status).toBe(201);
    expect((await rest(LEADS_PATH, second, { nonce })).status).toBe(201);

    const exported = await exportFor(email);
    expect(exported.data).toHaveLength(2);
    const names = exported.data.map((item) => item.data.find((field) => 'Name' === field.name)?.value);
    expect(names).toContain('First Lead');
    expect(names).toContain('Second Lead');
  });

  it('erases every matching lead through the registered eraser filter, and reports no items removed for an email with none', async () => {
    const email = `privacy-erase-${crypto.randomUUID()}@example.com`;
    const lead = validLead({ email, name: 'Privacy Erase Test' });
    const res = await rest(LEADS_PATH, lead, { nonce });
    expect(res.status).toBe(201);

    const leadsTable = await table();
    const before = await sqlWp(`SELECT id FROM ${leadsTable} WHERE email = '${email}'`);
    expect(before).toHaveLength(1);

    const erased = await eraseFor(email);
    expect(erased.done).toBe(true);
    expect(erased.items_removed).toBe(true);
    // The row itself is gone, but copies still exist outside this database: the lead was synced
    // to n8n inline right after insert (delivery is disabled for this whole file, but the eraser
    // itself makes no assumption about that — it always warns), so a copy can still sit in the
    // Moving leads sheet, in the two notification emails already sent, or in a failed n8n
    // execution's stored data for up to 168 h. The eraser can't reach any of those, so it must
    // say so instead of reporting a full erasure — named by this lead's own MQ-… reference, the
    // one identifier a site owner can actually search the sheet and their inbox for.
    expect(erased.items_retained).toBe(true);
    expect(erased.messages.length).toBeGreaterThan(0);
    expect(erased.messages.join(' ')).toContain(referenceFor(lead.submission_id as string));
    expect(erased.messages.join(' ')).toMatch(/sheet/i);
    expect(erased.messages.join(' ')).toMatch(/email|gmail/i);
    expect(erased.messages.join(' ')).toMatch(/n8n/i);

    const after = await sqlWp(`SELECT id FROM ${leadsTable} WHERE email = '${email}'`);
    expect(after).toHaveLength(0);

    const emptyErase = await eraseFor(`no-such-lead-${crypto.randomUUID()}@example.com`);
    expect(emptyErase.items_removed).toBe(false);
    expect(emptyErase.items_retained).toBe(false);
    expect(emptyErase.messages).toEqual([]);
  });

  it('erases a lead whose status is unparseable, which the exporter would have skipped', async () => {
    const leadsTable = await table();
    const email = `privacy-erase-poison-${crypto.randomUUID()}@example.com`;
    const uuid = crypto.randomUUID();
    await sqlWp(
      `INSERT INTO ${leadsTable} (request_uuid, created_at, status, move_type, rooms, origin_city, destination_city, distance_km, move_date, extras, customer_name, phone, email, consent_at, estimate_cop, estimate_low_cop, estimate_high_cop, sync_status, attempts, next_attempt_at, last_error, sent_at)
       VALUES ('${uuid}', UTC_TIMESTAMP(), 'not-a-real-status', 'apartment', 2, 'Barranquilla', 'Cartagena', 120, '2026-11-20', '', 'Privacy Erase Poison Row', '570000000006', '${email}', UTC_TIMESTAMP(), 1130000, 1017000, 1243000, 'pending', 0, 0, '', NULL)`,
    );

    try {
      // The exporter's own find_by_email() goes through the parseable-rows path, so this row
      // never appears in an export — proof that the eraser's direct DELETE below isn't just
      // reusing the exporter's own lookup under the hood.
      const exported = await exportFor(email);
      expect(exported.data).toHaveLength(0);

      const erased = await eraseFor(email);
      expect(erased.items_removed).toBe(true);
      // The eraser warns by reference even for a row its own exporter can't parse: it deletes by
      // a direct SQL statement, not through the parsed-row path, so an unparseable status is no
      // excuse to skip the warning either.
      expect(erased.items_retained).toBe(true);
      expect(erased.messages.join(' ')).toContain(referenceFor(uuid));

      const after = await sqlWp(`SELECT id FROM ${leadsTable} WHERE request_uuid = '${uuid}'`);
      expect(after).toHaveLength(0);
    } finally {
      await sqlWp(`DELETE FROM ${leadsTable} WHERE request_uuid = '${uuid}'`);
    }
  });
});
