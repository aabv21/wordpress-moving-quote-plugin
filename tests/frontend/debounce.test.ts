import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../../src/frontend/lib/debounce.ts';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once for three calls within the window, with the last call’s args', () => {
    const calls: number[] = [];
    const debounced = debounce((n: number) => {
      calls.push(n);
    }, 300);

    debounced(1);
    vi.advanceTimersByTime(100);
    debounced(2);
    vi.advanceTimersByTime(100);
    debounced(3);
    vi.advanceTimersByTime(300);

    expect(calls).toEqual([3]);
  });

  it('cancel() stops the pending call', () => {
    const calls: number[] = [];
    const debounced = debounce((n: number) => {
      calls.push(n);
    }, 300);

    debounced(1);
    debounced.cancel();
    vi.advanceTimersByTime(300);

    expect(calls).toEqual([]);
  });
});
