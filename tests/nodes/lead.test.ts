import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLead } from '../../src/nodes/lead.ts';

const body = readFileSync('tests/fixtures/lead-payload.json', 'utf8').trim();
const valid = JSON.parse(body) as Record<string, unknown>;

function withMove(overrides: Record<string, unknown>): unknown {
  return { ...valid, move: { ...(valid.move as Record<string, unknown>), ...overrides } };
}

function withCustomer(overrides: Record<string, unknown>): unknown {
  return { ...valid, customer: { ...(valid.customer as Record<string, unknown>), ...overrides } };
}

function withEstimate(overrides: Record<string, unknown>): unknown {
  return { ...valid, estimate: { ...(valid.estimate as Record<string, unknown>), ...overrides } };
}

describe('parseLead', () => {
  it('accepts the exact fixture contract body, normalizing its WordPress locale to the email language', () => {
    expect(valid.locale).toBe('en_US');
    expect(parseLead(valid)).toEqual({ ...valid, locale: 'en' });
  });

  it('reads a Spanish WordPress locale as es', () => {
    expect(parseLead({ ...valid, locale: 'es_CO' })?.locale).toBe('es');
    expect(parseLead({ ...valid, locale: 'es-CO' })?.locale).toBe('es');
  });

  it('accepts a lead without contact, from an older plugin, as blank contact numbers', () => {
    const withoutContact: Record<string, unknown> = { ...valid };
    delete withoutContact.contact;
    expect(parseLead(withoutContact)?.contact).toEqual({ phone: '', whatsapp: '' });
  });

  it('rejects a contact phone that is not 10 to 15 digits', () => {
    for (const phone of ['123456789', '1234567890123456', '+570000000099', '57 000 000 0099', 570000000099]) {
      expect(parseLead({ ...valid, contact: { phone, whatsapp: '' } }), String(phone)).toBeNull();
      expect(parseLead({ ...valid, contact: { phone: '', whatsapp: phone } }), String(phone)).toBeNull();
    }
    expect(parseLead({ ...valid, contact: { phone: '', whatsapp: '' } })?.contact).toEqual({ phone: '', whatsapp: '' });
  });

  it('rejects an extra key in contact', () => {
    expect(parseLead({ ...valid, contact: { phone: '570000000099', whatsapp: '570000000099', email: 'x@example.com' } })).toBeNull();
    expect(parseLead({ ...valid, contact: 'x' })).toBeNull();
  });

  it('accepts a lead without status_url as an empty link', () => {
    const withoutStatus: Record<string, unknown> = { ...valid };
    delete withoutStatus.status_url;
    expect(parseLead(withoutStatus)?.status_url).toBe('');
    expect(parseLead({ ...valid, status_url: '' })?.status_url).toBe('');
  });

  it('reads the status_url PHP emits', () => {
    expect(parseLead(valid)?.status_url).toBe(valid.status_url);
  });

  it('rejects a status_url with a quote or a javascript: scheme', () => {
    for (const status_url of ['javascript:alert(1)', 'https://example.com/"onmouseover="x', 'https://example.com/<b>', 'https://example.com/a b', 'ftp://example.com/', '//example.com/', 42, null]) {
      expect(parseLead({ ...valid, status_url }), String(status_url)).toBeNull();
    }
  });

  it('falls back to en for an in-flight lead sent by a plugin version without the locale field', () => {
    const withoutLocale: Record<string, unknown> = { ...valid };
    delete withoutLocale.locale;
    expect(parseLead(withoutLocale)?.locale).toBe('en');
  });

  it('falls back to en for a row saved before the locale column existed, or a language the emails are not written in', () => {
    expect(parseLead({ ...valid, locale: '' })?.locale).toBe('en');
    expect(parseLead({ ...valid, locale: 'pt_BR' })?.locale).toBe('en');
  });

  it('rejects a locale that is not a string', () => {
    expect(parseLead({ ...valid, locale: 1 })).toBeNull();
    expect(parseLead({ ...valid, locale: null })).toBeNull();
    expect(parseLead({ ...valid, locale: ['es'] })).toBeNull();
  });

  it('rejects a non-object value', () => {
    expect(parseLead('not an object')).toBeNull();
    expect(parseLead(null)).toBeNull();
    expect(parseLead(undefined)).toBeNull();
    expect(parseLead([])).toBeNull();
  });

  it('rejects a reference that does not match MQ- plus the first 8 hex of request_uuid, uppercased', () => {
    expect(parseLead({ ...valid, reference: 'MQ-FFFFFFFF' })).toBeNull();
  });

  it('rejects submitted_at with no numeric UTC offset', () => {
    expect(parseLead({ ...valid, submitted_at: '2026-11-04T09:15:00Z' })).toBeNull();
  });

  it('accepts submitted_at with a positive numeric offset', () => {
    expect(parseLead({ ...valid, submitted_at: '2026-11-04T09:15:00+05:00' })).not.toBeNull();
  });

  it.each(['apartment', 'house', 'office'])('accepts move type %s', (type) => {
    expect(parseLead(withMove({ type }))).not.toBeNull();
  });

  it('rejects an unknown move type', () => {
    expect(parseLead(withMove({ type: 'yacht' }))).toBeNull();
  });

  it.each([1, 2, 3, 4, 5])('accepts rooms %d', (rooms) => {
    expect(parseLead(withMove({ rooms }))).not.toBeNull();
  });

  it.each([0, 6, -1, 2.5])('rejects rooms %d outside 1-5', (rooms) => {
    expect(parseLead(withMove({ rooms }))).toBeNull();
  });

  it('accepts every known extra, each once', () => {
    expect(parseLead(withMove({ extras: ['packing', 'furniture_assembly', 'storage', 'piano_fragile'] }))).not.toBeNull();
  });

  it('rejects an unknown extra', () => {
    expect(parseLead(withMove({ extras: ['teleportation'] }))).toBeNull();
  });

  it('accepts a move date far in the past or far in the future: the window is WordPress’s own submit rule, not checked here', () => {
    expect(parseLead(withMove({ date: '2000-01-01' }))).not.toBeNull();
    expect(parseLead(withMove({ date: '2099-12-31' }))).not.toBeNull();
  });

  it('rejects a move date that is not a valid calendar date', () => {
    expect(parseLead(withMove({ date: '2026-02-30' }))).toBeNull();
    expect(parseLead(withMove({ date: '2026-13-01' }))).toBeNull();
    expect(parseLead(withMove({ date: 'not-a-date' }))).toBeNull();
  });

  it.each([
    ['one character', 'A', false],
    ['two characters', 'Jo', true],
    ['100 characters', 'A'.repeat(100), true],
    ['101 characters', 'A'.repeat(101), false],
  ])('a name of %s is accepted: %s', (_label, name, accepted) => {
    expect(parseLead(withCustomer({ name })) !== null).toBe(accepted);
  });

  it('rejects a phone outside 10-15 digits', () => {
    expect(parseLead(withCustomer({ phone: '123456789' }))).toBeNull();
    expect(parseLead(withCustomer({ phone: '1234567890123456' }))).toBeNull();
    expect(parseLead(withCustomer({ phone: '1234567890' }))).not.toBeNull();
  });

  it.each([
    [254, true],
    [255, false],
  ])('an email of %d characters is accepted: %s', (length, accepted) => {
    const email = `${'a'.repeat(length - '@example.com'.length)}@example.com`;
    expect(email).toHaveLength(length);
    expect(parseLead(withCustomer({ email })) !== null).toBe(accepted);
  });

  it.each([
    ['0', 0, true],
    ['-1', -1, false],
  ])('a distance of %s km is accepted: %s', (_label, distanceKm, accepted) => {
    expect(parseLead(withMove({ distance_km: distanceKm })) !== null).toBe(accepted);
  });

  it.each([
    ['origin', { origin: '' }],
    ['destination', { destination: '' }],
  ])('rejects an empty %s', (_label, overrides) => {
    expect(parseLead(withMove(overrides))).toBeNull();
  });

  it.each(['a@.com', 'a@example.', 'a@example'])('rejects %s as team_email', (teamEmail) => {
    expect(parseLead({ ...valid, team_email: teamEmail })).toBeNull();
  });

  it.each([
    ['low equal to high', 0, true],
    ['low above high by one', 1, false],
  ])('an estimate with %s is accepted: %s', (_label, excess, accepted) => {
    const { high } = valid.estimate as { high: number };
    expect(parseLead(withEstimate({ low: high + excess })) !== null).toBe(accepted);
  });

  it('rejects a currency other than COP', () => {
    expect(parseLead(withEstimate({ currency: 'USD' }))).toBeNull();
  });

  it('rejects low greater than high, regardless of amount', () => {
    const estimate = valid.estimate as { low: number; high: number };
    expect(parseLead(withEstimate({ low: estimate.high, high: estimate.low }))).toBeNull();
  });

  it('accepts an amount outside [low, high]: range_percent 0 can make amount fall outside a low/high rounded to the nearest 1,000 COP', () => {
    const estimate = valid.estimate as { low: number; high: number };
    expect(parseLead(withEstimate({ amount: estimate.low - 1 }))).not.toBeNull();
    expect(parseLead(withEstimate({ amount: estimate.high + 1 }))).not.toBeNull();
  });

  it('accepts an amount equal to low or high', () => {
    const estimate = valid.estimate as { low: number; high: number };
    expect(parseLead(withEstimate({ amount: estimate.low }))).not.toBeNull();
    expect(parseLead(withEstimate({ amount: estimate.high }))).not.toBeNull();
  });

  it('rejects a missing required field', () => {
    const withoutReference: Record<string, unknown> = { ...valid };
    delete withoutReference.reference;
    expect(parseLead(withoutReference)).toBeNull();
  });

  it('rejects an extra, unexpected top-level field', () => {
    expect(parseLead({ ...valid, unexpected: true })).toBeNull();
  });

  it('accepts an empty site_name: the raw, unsanitized blog title is blank once a merchant clears it', () => {
    expect(parseLead({ ...valid, site_name: '' })).not.toBeNull();
  });

  it('accepts a name at the maximum length that contains an emoji, counted by code point', () => {
    const name = `${'A'.repeat(99)}😀`;
    expect(Array.from(name)).toHaveLength(100);
    expect(parseLead(withCustomer({ name }))).not.toBeNull();
  });

  it('rejects a name one code point over the maximum, with an emoji at the boundary', () => {
    const name = `${'A'.repeat(100)}😀`;
    expect(Array.from(name)).toHaveLength(101);
    expect(parseLead(withCustomer({ name }))).toBeNull();
  });

  it('rejects an uppercase request_uuid: event_id is case-sensitive text, and PHP lowercases every UUID it accepts', () => {
    const requestUuid = (valid.request_uuid as string).toUpperCase();
    expect(parseLead({ ...valid, request_uuid: requestUuid })).toBeNull();
  });

  it('rejects move.extras with a duplicate entry', () => {
    expect(parseLead(withMove({ extras: ['packing', 'packing'] }))).toBeNull();
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an estimate amount of %s', (amount) => {
    expect(parseLead(withEstimate({ amount, low: amount, high: amount }))).toBeNull();
  });

  it.each([
    ['an out-of-range month', '2026-13-01T09:15:00-05:00'],
    ['an out-of-range hour', '2026-11-04T25:15:00-05:00'],
    ['an offset of -15:00', '2026-11-04T09:15:00-15:00'],
    ['every field out of range', '2026-99-99T99:99:99+99:99'],
    ['an offset just past the widest, +14:01', '2026-11-04T09:15:00+14:01'],
  ])('rejects submitted_at with %s, which a plain regex would accept', (_label, submittedAt) => {
    expect(parseLead({ ...valid, submitted_at: submittedAt })).toBeNull();
  });

  it('accepts submitted_at with the widest real UTC offset, +14:00', () => {
    expect(parseLead({ ...valid, submitted_at: '2026-11-04T09:15:00+14:00' })).not.toBeNull();
  });

  it('rejects team_email with no @ or an empty local or domain part', () => {
    expect(parseLead({ ...valid, team_email: 'not-an-email' })).toBeNull();
    expect(parseLead({ ...valid, team_email: '@example.com' })).toBeNull();
    expect(parseLead({ ...valid, team_email: 'team@' })).toBeNull();
  });

  it('rejects a control character in customer.name: LeadValidator::validate_name() normalizes them, so a genuine payload never carries one', () => {
    expect(parseLead(withCustomer({ name: 'Ana\nPhone: 570000000099' }))).toBeNull();
  });

  it('rejects a control character in move.origin', () => {
    expect(parseLead(withMove({ origin: 'Barranquilla\nPhone: 570000000099' }))).toBeNull();
  });

  it('rejects a control character in move.destination', () => {
    expect(parseLead(withMove({ destination: 'Cartagena\nPhone: 570000000099' }))).toBeNull();
  });

  it.each(['\u0085', '\u2028', '\u2029'])('rejects a Unicode line break (%s) in customer.name', (char) => {
    expect(parseLead(withCustomer({ name: `Ana${char}Bo` }))).toBeNull();
  });

  it('rejects a quoted local part that would smuggle a second recipient', () => {
    expect(parseLead(withCustomer({ email: '"a,b"@example.com' }))).toBeNull();
    expect(parseLead({ ...valid, team_email: '"a,b"@example.com' })).toBeNull();
  });

  it('rejects whitespace inside the address', () => {
    expect(parseLead(withCustomer({ email: 'a b@example.com' }))).toBeNull();
    expect(parseLead({ ...valid, team_email: 'a b@example.com' })).toBeNull();
  });

  it('rejects a comma-separated list of addresses', () => {
    expect(parseLead(withCustomer({ email: 'x@example.com, y@example.com' }))).toBeNull();
    expect(parseLead({ ...valid, team_email: 'x@example.com, y@example.com' })).toBeNull();
  });

  it('accepts a simple address with a dotted or plus-tagged local part', () => {
    expect(parseLead(withCustomer({ email: 'customer@example.com' }))).not.toBeNull();
    expect(parseLead(withCustomer({ email: 'jose.pena+quotes@example.com' }))).not.toBeNull();
    expect(parseLead({ ...valid, team_email: 'customer@example.com' })).not.toBeNull();
    expect(parseLead({ ...valid, team_email: 'jose.pena+quotes@example.com' })).not.toBeNull();
  });
});
