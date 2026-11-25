import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEAM_LOCALE_NOTE } from '../../src/nodes/locale.ts';
import { run } from '../../src/nodes/weekly-digest.ts';
import { runCodeNode } from '../lib/code-node.ts';

const now = '2026-11-23T08:00:00.000-05:00';
const config = { team_locale: 'en', digest_email: 'team@example.com', google: { leads_sheet_id: 'sheet-id' } };

function row(receivedAt: unknown, origin: string, destination: string, moveType: string, estimate: unknown): Record<string, unknown> {
  return { received_at: receivedAt, origin, destination, move_type: moveType, estimate_cop: estimate };
}

const rows = [
  row('2026-11-17 10:00', 'Barranquilla', 'Cartagena', 'Apartment', 1330000),
  row('2026-11-18 11:00', 'Barranquilla', 'Cartagena', 'House', '1000000'),
  row('2026-11-19 12:00', 'Barranquilla', 'Santa Marta', 'Office', 2000000),
  row('2026-11-20 09:00', 'Cartagena', 'Barranquilla', 'Apartment', 1500000),
  row('2026-11-22 18:30', 'Santa Marta', 'Barranquilla', 'Apartment', 1000000),
];

describe('weekly-digest', () => {
  it("counts whole Bogota days, Monday 00:00 to Monday 00:00, matching the subject's dates", () => {
    const edge = [
      row('2026-11-16 00:00', 'A', 'B', 'House', 100000),
      row('2026-11-16 04:00', 'A', 'B', 'House', 100000),
      row('2026-11-15 23:59', 'A', 'B', 'House', 100000),
      row('2026-11-23 00:00', 'A', 'B', 'House', 100000),
      row('2026-11-22 23:59', 'A', 'B', 'House', 100000),
    ];
    const { subject, text } = run({ config, rows: edge, now });
    expect(subject).toBe('[Chivabox Movers] Weekly summary: 3 leads, 2026-11-16 to 2026-11-22');
    expect(text.split('\n')[0]).toBe('Leads: 3');
  });

  it('sums, averages and ranks routes', () => {
    const out = run({ config, rows, now });
    expect(out.to).toBe('team@example.com');
    expect(out.subject).toBe('[Chivabox Movers] Weekly summary: 5 leads, 2026-11-16 to 2026-11-22');
    expect(out.text.split('\n')).toEqual([
      'Leads: 5',
      'Estimated value: COP 6,830,000',
      'Average estimate: COP 1,366,000',
      'Top routes: Barranquilla to Cartagena (2), Barranquilla to Santa Marta (1), Cartagena to Barranquilla (1)',
      'By move type: Apartment 3, House 1, Office 1',
      'Sheet: https://docs.google.com/spreadsheets/d/sheet-id',
    ]);
  });

  it('writes the summary in Spanish when team_locale is es', () => {
    const out = run({ config: { ...config, team_locale: 'es' }, rows, now });
    expect(out.subject).toBe('[Chivabox Movers] Resumen semanal: 5 solicitudes, del 2026-11-16 al 2026-11-22');
    expect(out.text.split('\n')).toEqual([
      'Solicitudes: 5',
      'Valor estimado: COP 6.830.000',
      'Estimado promedio: COP 1.366.000',
      'Rutas principales: Barranquilla a Cartagena (2), Barranquilla a Santa Marta (1), Cartagena a Barranquilla (1)',
      'Por tipo: Apartamento 3, Casa 1, Oficina 1',
      'Hoja: https://docs.google.com/spreadsheets/d/sheet-id',
    ]);
  });

  it('falls back to English with the note for an invalid team_locale', () => {
    const out = run({ config: { ...config, team_locale: 'fr' }, rows, now });
    expect(out.subject).toContain('Weekly summary');
    expect(out.text.split('\n').at(-1)).toBe(TEAM_LOCALE_NOTE);
  });

  it('an empty sheet gives zero leads, n/a and none', () => {
    const out = run({ config, rows: [], now });
    expect(out.text.split('\n')).toEqual([
      'Leads: 0',
      'Estimated value: COP 0',
      'Average estimate: n/a',
      'Top routes: none',
      'By move type: Apartment 0, House 0, Office 0',
      'Sheet: https://docs.google.com/spreadsheets/d/sheet-id',
    ]);
    expect(run({ config: { ...config, team_locale: 'es' }, rows: [], now }).text).toContain('Estimado promedio: no aplica\nRutas principales: ninguna');
  });

  it('skips a row without a parseable received_at or estimate', () => {
    const messy = [
      row('not a date', 'A', 'B', 'House', 100000),
      row('', 'A', 'B', 'House', 100000),
      row(undefined, 'A', 'B', 'House', 100000),
      row('2026-11-18 11:00', 'A', 'B', 'House', 'n/a'),
      row('2026-11-18 11:00', 'A', 'B', 'House', ''),
      row('2026-11-18 11:00', 'A', 'B', 'House', undefined),
      row('2026-11-18 11:00', 'A', 'B', 'House', 100000),
    ];
    expect(run({ config, rows: messy, now }).text.split('\n').slice(0, 3)).toEqual(['Leads: 1', 'Estimated value: COP 100,000', 'Average estimate: COP 100,000']);
  });

  it('keeps a line break in a sheet cell out of the summary', () => {
    const forged = [row('2026-11-18 11:00', 'A\nSheet: https://evil.example', 'B', 'House', 100000)];
    const lines = run({ config, rows: forged, now }).text.split('\n');
    expect(lines.filter((line) => line.startsWith('Sheet:'))).toHaveLength(1);
  });

  it('throws when digest_email is missing, and says so apart from an invalid one', () => {
    for (const digest_email of [undefined, '']) {
      expect(() => run({ config: { ...config, digest_email }, rows, now })).toThrow('config.digest_email is not set');
    }
    for (const digest_email of ['not an email', 42, 'a@b.com\nbcc: x@example.com']) {
      expect(() => run({ config: { ...config, digest_email }, rows, now })).toThrow('config.digest_email is not a simple email address');
    }
  });

  it('a manual run on a Wednesday afternoon counts whole days back from midnight of that day', () => {
    const midweek = '2026-11-25T15:30:00.000-05:00';
    expect(run({ config, rows, now: midweek }).subject).toBe('[Chivabox Movers] Weekly summary: 4 leads, 2026-11-18 to 2026-11-24');
    expect(run({ config, rows, now: '2026-11-23T00:00:00.000-05:00' }).text.split('\n')[0]).toBe('Leads: 5');
  });

  it('accepts the committed config.example.json', () => {
    const example = JSON.parse(readFileSync('config/config.example.json', 'utf8')) as typeof config;
    expect(run({ config: example, rows: [], now }).to).toMatch(/@example\.com$/);
  });

  it('the committed Compose digest jsCode gives the same summary in the Code-node sandbox', () => {
    const input = { config, rows, now };
    expect(runCodeNode('weekly-digest.json', 'Compose digest', input)).toEqual([{ json: run(input) }]);
  });
});
