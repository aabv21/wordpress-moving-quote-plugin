import { describe, expect, it } from 'vitest';
import type { ApiResult } from '../../src/frontend/lib/api.ts';
import { affectsEstimate, ESTIMATE_PLACEHOLDER, estimateDisplayText } from '../../src/frontend/lib/estimate-display.ts';

describe('estimateDisplayText', () => {
  it('returns the server display string on success', () => {
    const result: ApiResult = { ok: true, status: 200, data: { display: 'COP 1,017,000 – 1,243,000' } };
    expect(estimateDisplayText(result)).toBe('COP 1,017,000 – 1,243,000');
  });

  it('returns the placeholder when the estimate failed with an unknown route', () => {
    const result: ApiResult = { ok: false, status: 422, code: 'moving_quote_invalid', message: 'invalid', fieldErrors: { destination: 'unknown_route' } };
    expect(estimateDisplayText(result)).toBe(ESTIMATE_PLACEHOLDER);
  });

  it('returns the placeholder when rate-limited', () => {
    const result: ApiResult = { ok: false, status: 429, code: 'moving_quote_rate_limited', message: 'too many', fieldErrors: {} };
    expect(estimateDisplayText(result)).toBe(ESTIMATE_PLACEHOLDER);
  });

  it('returns the placeholder on a network error', () => {
    const result: ApiResult = { ok: false, status: 0, code: 'network_error', message: 'network_error', fieldErrors: {} };
    expect(estimateDisplayText(result)).toBe(ESTIMATE_PLACEHOLDER);
  });

  it('returns the placeholder when a successful response has no display string', () => {
    const result: ApiResult = { ok: true, status: 200, data: {} };
    expect(estimateDisplayText(result)).toBe(ESTIMATE_PLACEHOLDER);
  });
});

describe('affectsEstimate', () => {
  it.each(['move_type', 'rooms', 'origin', 'destination', 'extras', 'move_date'])('is true for %s', (field) => {
    expect(affectsEstimate(field)).toBe(true);
  });

  it.each(['name', 'phone', 'email'])('is false for %s', (field) => {
    expect(affectsEstimate(field)).toBe(false);
  });
});
