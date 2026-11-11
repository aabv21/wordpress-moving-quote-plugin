import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MESSAGES, run, SHEET_HEADERS, TEAM_LOCALE_NOTE } from '../../src/nodes/map-lead.ts';
import { parseLead, type Lead } from '../../src/nodes/lead.ts';
import { LOCALES } from '../../src/nodes/locale.ts';

const parsed = parseLead(JSON.parse(readFileSync('tests/fixtures/lead-payload.json', 'utf8')));
if (!parsed) throw new Error('the lead payload fixture must parse');
const lead: Lead = parsed;
const spanishLead: Lead = { ...lead, locale: 'es' };
const config = { google: { leads_sheet_id: 'sheet-id', leads_tab: 'Moving leads' }, alerts: { error_email: 'ops@example.com' }, team_locale: 'en' };
const spanishTeamConfig = { ...config, team_locale: 'es' };

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
      request_uuid: '6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b',
    });
  });

  it('gives two leads that share a reference different sheet match keys', () => {
    // Same first 8 hex, so the same MQ- reference; the sheet upsert keys on the full request_uuid.
    const other: Lead = { ...lead, request_uuid: '6f1c2a9e-0000-4000-8000-000000000000' };
    const first = run({ lead, config }).row;
    const second = run({ lead: other, config }).row;
    expect(second.reference).toBe(first.reference);
    expect(second.request_uuid).not.toBe(first.request_uuid);
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

  it('pluralizes rooms, and 5 reads as "5 or more"', () => {
    expect(run({ lead, config }).team.text).toContain('Type: Apartment, 2 rooms');
    expect(run({ lead: { ...lead, move: { ...lead.move, rooms: 1 } }, config }).team.text).toContain('Type: Apartment, 1 room\n');
    expect(run({ lead: { ...lead, move: { ...lead.move, rooms: 5 } }, config }).team.text).toContain('5 or more rooms');
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

  it('writes the customer email in English for an English lead', () => {
    const { customer } = run({ lead, config: spanishTeamConfig });
    expect(customer.subject).toBe('Your moving estimate from Chivabox Movers');
    expect(customer.html).toContain('Hi José Peña,');
  });

  it('writes the customer email in Spanish for a Spanish lead, with Colombian number grouping and a Spanish date', () => {
    const { customer } = run({ lead: spanishLead, config });
    expect(customer.subject).toBe('Su cotización de mudanza de Chivabox Movers');
    for (const s of [
      'Hola, José Peña:',
      'COP 1.197.000 – 1.463.000',
      'De Barranquilla a Cartagena, el viernes 20 de noviembre de 2026',
      'Este valor es un estimado. Confirmamos el precio final después de una visita o una videollamada.',
      'se comunicará con usted',
      'Referencia: MQ-6F1C2A9E',
    ])
      expect(customer.html).toContain(s);
    expect(customer.html).not.toMatch(/\b(Hi|Your moving estimate|This is an estimate|Reference:)/);
  });

  it('still escapes customer text in the Spanish HTML email', () => {
    const out = run({ lead: { ...spanishLead, customer: { ...spanishLead.customer, name: '<b>Ana & "Bo"</b>' } }, config });
    expect(out.customer.html).toContain('Hola, &lt;b&gt;Ana &amp; &quot;Bo&quot;&lt;/b&gt;:');
    expect(out.customer.html).not.toContain('<b>Ana');
  });

  it("writes the team alert in the configured team_locale, never the lead's own language", () => {
    expect(run({ lead: spanishLead, config }).team.subject).toBe('New lead MQ-6F1C2A9E: Barranquilla to Cartagena on 2026-11-20');

    const { team } = run({ lead, config: spanishTeamConfig });
    expect(team.subject).toBe('Nueva solicitud MQ-6F1C2A9E: Barranquilla a Cartagena el 2026-11-20');
    expect(team.text.split('\n')).toEqual([
      'Nombre: José Peña',
      'Teléfono: 570000000001',
      'Correo: jose@example.com',
      'Fecha de la mudanza: viernes 20 de noviembre de 2026',
      'Ruta: Barranquilla a Cartagena (120 km)',
      'Tipo: Apartamento, 2 habitaciones',
      'Servicios adicionales: Embalaje',
      'Estimado: COP 1.197.000 – 1.463.000',
      'Referencia: MQ-6F1C2A9E',
    ]);
  });

  it('pluralizes rooms and lists extras in Spanish too', () => {
    const one = run({ lead: { ...lead, move: { ...lead.move, rooms: 1, extras: [] } }, config: spanishTeamConfig }).team.text;
    expect(one).toContain('Tipo: Apartamento, 1 habitación\n');
    expect(one).toContain('Servicios adicionales: Ninguno');
    const five = run({ lead: { ...lead, move: { ...lead.move, rooms: 5, extras: ['storage', 'piano_fragile'] } }, config: spanishTeamConfig }).team.text;
    expect(five).toContain('5 o más habitaciones');
    expect(five).toContain('Servicios adicionales: Almacenamiento temporal, Piano u objetos frágiles');
  });

  it('keeps line breaks out of the Spanish team alert too', () => {
    const name = 'Ana\nTeléfono: 570000000099';
    const { team } = run({ lead: { ...lead, customer: { ...lead.customer, name } }, config: spanishTeamConfig });
    expect(team.text.split('\n').filter((line) => line.startsWith('Teléfono:'))).toHaveLength(1);
  });

  it('writes the team alert in English when the config predates team_locale', () => {
    const legacyConfig = { google: config.google, alerts: config.alerts };
    expect(run({ lead, config: legacyConfig }).team.subject).toBe('New lead MQ-6F1C2A9E: Barranquilla to Cartagena on 2026-11-20');
  });

  it.each([['ES'], ['es_CO'], ['fr'], [1], [null]])('never blocks a lead on an invalid team_locale (%j): English team copy with a one-line note, the customer email untouched', (teamLocale) => {
    const { team, customer } = run({ lead: spanishLead, config: { ...config, team_locale: teamLocale } });

    expect(customer.subject).toBe('Su cotización de mudanza de Chivabox Movers');
    expect(customer.html).toContain('Hola, José Peña:');

    expect(team.subject).toBe('New lead MQ-6F1C2A9E: Barranquilla to Cartagena on 2026-11-20');
    const lines = team.text.split('\n');
    expect(lines[0]).toBe('Name: José Peña');
    expect(lines.filter((line) => line.includes('team_locale'))).toEqual([TEAM_LOCALE_NOTE]);
    expect(lines.at(-1)).toBe(TEAM_LOCALE_NOTE);
  });

  it('adds no note for a valid or missing team_locale', () => {
    expect(run({ lead, config }).team.text).not.toContain('team_locale');
    expect(run({ lead, config: spanishTeamConfig }).team.text).not.toContain('team_locale');
    expect(run({ lead, config: { google: config.google, alerts: config.alerts } }).team.text).not.toContain('team_locale');
  });

  it('writes the customer email in English for a lead that carries no usable locale', () => {
    const withoutLocale: Record<string, unknown> = { ...lead };
    delete withoutLocale.locale;
    const legacy = withoutLocale as unknown as Lead;
    expect(run({ lead: legacy, config }).customer.subject).toBe('Your moving estimate from Chivabox Movers');
    expect(run({ lead: { ...lead, locale: 'pt' as unknown as Lead['locale'] }, config }).customer.subject).toBe('Your moving estimate from Chivabox Movers');
  });

  it('keeps the sheet row in English whatever the languages, so the sheet stays one consistent dataset', () => {
    const { row } = run({ lead: spanishLead, config: spanishTeamConfig });
    expect(row.move_type).toBe('Apartment');
    expect(row.extras).toBe('Packing');
  });

  it('has every message in both languages, none empty', () => {
    const shape = (locale: (typeof LOCALES)[number]): string[] => Object.keys(MESSAGES[locale]).sort();
    expect(shape('es')).toEqual(shape('en'));
    for (const locale of LOCALES) {
      const m = MESSAGES[locale];
      for (const [key, value] of Object.entries(m)) {
        if (typeof value === 'string') expect(value.trim(), `${locale}.${key}`).not.toBe('');
        else if (typeof value === 'function') expect((value as (...args: string[]) => string)('A', 'B', 'C', 'D').trim(), `${locale}.${key}`).not.toBe('');
        else for (const [sub, text] of Object.entries(value as Record<string, string>)) expect(text.trim(), `${locale}.${key}.${sub}`).not.toBe('');
      }
      expect(Object.keys(m.moveTypes).sort()).toEqual(['apartment', 'house', 'office']);
      expect(Object.keys(m.extras).sort()).toEqual(['furniture_assembly', 'packing', 'piano_fragile', 'storage']);
    }
  });
});
