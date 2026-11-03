import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { run, SHEET_HEADERS } from '../../src/nodes/map-lead.ts';
import type { Lead } from '../../src/nodes/lead.ts';

const lead = JSON.parse(readFileSync('tests/fixtures/lead-payload.json', 'utf8')) as Lead;
const config = { google: { leads_sheet_id: 'sheet-id', leads_tab: 'Moving leads' }, alerts: { error_email: 'ops@example.com' } };

describe('map-lead', () => {
  it('maps the sheet row in header order', () => {
    const { row } = run({ lead, config });
    expect(Object.keys(row)).toEqual([...SHEET_HEADERS]);
    expect(row).toEqual({
      received_at: '2026-11-04 09:15',
      reference: 'MQ-6F1C2A9E',
      name: 'José Peña',
      phone: '570000000001',
      email: 'jose@example.com',
      move_date: '2026-11-20',
      move_type: 'Apartment',
      rooms: 2,
      origin: 'Barranquilla',
      destination: 'Cartagena',
      distance_km: 120,
      extras: 'Packing',
      estimate_cop: 1330000,
      estimate_low_cop: 1197000,
      estimate_high_cop: 1463000,
    });
  });

  it('passes formula-looking text through unchanged for the RAW append', () => {
    const name = '=HYPERLINK("http://example.com","x")';
    expect(run({ lead: { ...lead, customer: { ...lead.customer, name } }, config }).row.name).toBe(name);
  });

  it('writes the team alert as plain text, with no tel: or mailto: links', () => {
    const { team } = run({ lead, config });
    expect(team.to).toBe('team@example.com');
    expect(team.subject).toBe('New lead MQ-6F1C2A9E: Barranquilla to Cartagena on 2026-11-20');
    for (const s of ['COP 1,197,000 – 1,463,000', '570000000001', 'jose@example.com', 'Friday, November 20, 2026', '120 km', 'Packing', 'MQ-6F1C2A9E'])
      expect(team.text).toContain(s);
    expect(team.text).not.toContain('tel:');
    expect(team.text).not.toContain('mailto:');
  });

  it('writes the customer summary', () => {
    const { customer } = run({ lead, config });
    expect([customer.to, customer.reply_to, customer.subject]).toEqual(['jose@example.com', 'team@example.com', 'Your moving estimate from Chivabox Movers']);
    for (const s of ['Hi José Peña', 'COP 1,197,000 – 1,463,000', 'This is an estimate. We confirm the final price after a visit or video call.', 'MQ-6F1C2A9E'])
      expect(customer.html).toContain(s);
  });

  it('escapes customer text in the customer HTML email', () => {
    const out = run({ lead: { ...lead, customer: { ...lead.customer, name: '<b>Ana & "Bo"</b>' } }, config });
    expect(out.customer.html).toContain('&lt;b&gt;Ana &amp; &quot;Bo&quot;&lt;/b&gt;');
    expect(out.customer.html).not.toContain('<b>Ana');
  });

  it('keeps line breaks out of subjects', () => {
    expect(run({ lead: { ...lead, site_name: 'Chivabox\r\nBcc: x@example.com' }, config }).customer.subject).not.toMatch(/[\r\n]/);
  });

  it('never lets a line break in a lead field forge an extra line in the team alert', () => {
    const name = 'Ana\nPhone: 570000000099';
    const { team } = run({ lead: { ...lead, customer: { ...lead.customer, name } }, config });
    const lines = team.text.split('\n');
    expect(lines.filter((line) => line.startsWith('Phone:'))).toHaveLength(1);
    expect(lines.some((line) => line.startsWith('570000000099'))).toBe(false);
  });

  it('normalizes a Unicode line separator (U+2028) to a space in the team alert', () => {
    const name = 'Ana\u2028Bo';
    const { team } = run({ lead: { ...lead, customer: { ...lead.customer, name } }, config });
    expect(team.text).toContain('Name: Ana Bo');
    expect(team.text).not.toContain('\u2028');
  });

  it('normalizes a line break in the reference too, even though the contract never produces one', () => {
    const { team } = run({ lead: { ...lead, reference: 'MQ-6F1C2A9E\nPhone: 570000000099' }, config });
    expect(team.text.split('\n').filter((line) => line.startsWith('Phone:'))).toHaveLength(1);
  });

  it('5 rooms shows as "5 or more"', () => {
    const { team } = run({ lead: { ...lead, move: { ...lead.move, rooms: 5 } }, config });
    expect(team.text).toContain('5 or more room(s)');
  });

  it('no extras shows as "None"', () => {
    const { team } = run({ lead: { ...lead, move: { ...lead.move, extras: [] } }, config });
    expect(team.text).toContain('Extras: None');
  });

  it('several extras are joined with ", "', () => {
    const { team } = run({ lead: { ...lead, move: { ...lead.move, extras: ['packing', 'storage'] } }, config });
    expect(team.text).toContain('Extras: Packing, Temporary storage');
  });

  it('a non-Bogota submitted_at converts to Bogota time in received_at and the email date', () => {
    const { row, team } = run({ lead: { ...lead, submitted_at: '2026-11-04T14:15:00+00:00' }, config });
    expect(row.received_at).toBe('2026-11-04 09:15');
    expect(team.text).toContain('Friday, November 20, 2026');
  });
});
