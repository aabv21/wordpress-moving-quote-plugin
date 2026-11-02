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
  it('accepts the exact fixture contract body', () => {
    expect(parseLead(valid)).toEqual(valid);
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

  it('rejects a name shorter than 2 or longer than 100 characters', () => {
    expect(parseLead(withCustomer({ name: 'A' }))).toBeNull();
    expect(parseLead(withCustomer({ name: 'A'.repeat(101) }))).toBeNull();
    expect(parseLead(withCustomer({ name: 'Jo' }))).not.toBeNull();
    expect(parseLead(withCustomer({ name: 'A'.repeat(100) }))).not.toBeNull();
  });

  it('rejects a phone outside 10-15 digits', () => {
    expect(parseLead(withCustomer({ phone: '123456789' }))).toBeNull();
    expect(parseLead(withCustomer({ phone: '1234567890123456' }))).toBeNull();
    expect(parseLead(withCustomer({ phone: '1234567890' }))).not.toBeNull();
  });

  it('rejects an email over 254 characters', () => {
    const long = `${'a'.repeat(246)}@example.com`;
    expect(long.length).toBeGreaterThan(254);
    expect(parseLead(withCustomer({ email: long }))).toBeNull();
  });

  it('rejects a currency other than COP', () => {
    expect(parseLead(withEstimate({ currency: 'USD' }))).toBeNull();
  });

  it('rejects an amount outside [low, high]', () => {
    expect(parseLead(withEstimate({ amount: (valid.estimate as { low: number }).low - 1 }))).toBeNull();
    expect(parseLead(withEstimate({ amount: (valid.estimate as { high: number }).high + 1 }))).toBeNull();
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

  it('rejects submitted_at with an out-of-range month, hour, or offset that a plain regex would accept', () => {
    expect(parseLead({ ...valid, submitted_at: '2026-13-01T09:15:00-05:00' })).toBeNull();
    expect(parseLead({ ...valid, submitted_at: '2026-11-04T25:15:00-05:00' })).toBeNull();
    expect(parseLead({ ...valid, submitted_at: '2026-11-04T09:15:00-15:00' })).toBeNull();
    expect(parseLead({ ...valid, submitted_at: '2026-99-99T99:99:99+99:99' })).toBeNull();
  });

  it('accepts submitted_at with the widest real UTC offset, +14:00', () => {
    expect(parseLead({ ...valid, submitted_at: '2026-11-04T09:15:00+14:00' })).not.toBeNull();
  });

  it('rejects team_email with no @ or an empty local or domain part', () => {
    expect(parseLead({ ...valid, team_email: 'not-an-email' })).toBeNull();
    expect(parseLead({ ...valid, team_email: '@example.com' })).toBeNull();
    expect(parseLead({ ...valid, team_email: 'team@' })).toBeNull();
  });
});
