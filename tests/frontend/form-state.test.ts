import { describe, expect, it } from 'vitest';
import { estimateRequest, firstStepWithError, missingRequired } from '../../src/frontend/lib/form-state.ts';

const step1 = { move_type: 'apartment', rooms: '2', origin: 'Barranquilla', destination: 'Cartagena', move_date: '2026-11-20' };

describe('form state', () => {
  it('asks for an estimate once type, rooms, and both cities are set', () => {
    expect(estimateRequest({ ...step1, extras: ['packing'] })).toEqual({ move_type: 'apartment', rooms: 2, origin: 'Barranquilla', destination: 'Cartagena', extras: ['packing'] });
    expect(estimateRequest({ ...step1, destination: '' })).toBeNull();
  });
  it('lists missing required fields per step', () => {
    expect(missingRequired(0, { ...step1, move_date: '' })).toEqual(['move_date']);
    expect(missingRequired(1, {})).toEqual([]);
    expect(missingRequired(2, { name: 'Ana', phone: '', email: 'a@example.com', consent: false })).toEqual(['phone', 'consent']);
  });
  it('returns to the first step that has a server error', () => {
    expect(firstStepWithError({ email: 'x', destination: 'y' })).toBe(0);
    expect(firstStepWithError({ email: 'x' })).toBe(2);
  });
});
