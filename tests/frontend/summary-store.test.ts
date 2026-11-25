import { describe, expect, it } from 'vitest';
import { readSummary, saveSummary, SUMMARY_KEY, type ThanksSummary } from '../../src/frontend/lib/summary-store.ts';

const SUMMARY: ThanksSummary = { reference: 'MQ-1A2B3C4D', route: 'Barranquilla → Cartagena', date: '2026-12-01', estimate: 'COP 1,017,000 – 1,243,000' };

/** A `Storage`-like map, the only part the store uses. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('the thank-you summary store', () => {
  it('reads back a summary saved for the same reference', () => {
    const storage = memoryStorage();
    saveSummary(storage, SUMMARY);
    expect(storage.getItem(SUMMARY_KEY)).not.toBeNull();
    expect(readSummary(storage, 'MQ-1A2B3C4D')).toEqual(SUMMARY);
  });

  it('returns null for another reference, broken JSON, a missing field, or a storage that throws', () => {
    const storage = memoryStorage();
    saveSummary(storage, SUMMARY);
    expect(readSummary(storage, 'MQ-00000000')).toBeNull();

    storage.setItem(SUMMARY_KEY, '{broken');
    expect(readSummary(storage, 'MQ-1A2B3C4D')).toBeNull();

    storage.setItem(SUMMARY_KEY, JSON.stringify({ ...SUMMARY, estimate: undefined }));
    expect(readSummary(storage, 'MQ-1A2B3C4D')).toBeNull();

    storage.setItem(SUMMARY_KEY, JSON.stringify({ ...SUMMARY, date: 20261201 }));
    expect(readSummary(storage, 'MQ-1A2B3C4D')).toBeNull();

    storage.setItem(SUMMARY_KEY, 'null');
    expect(readSummary(storage, 'MQ-1A2B3C4D')).toBeNull();

    expect(readSummary(throwing, 'MQ-1A2B3C4D')).toBeNull();
    expect(() => {
      saveSummary(throwing, SUMMARY);
    }).not.toThrow();
  });
});
