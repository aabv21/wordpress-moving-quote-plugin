import { describe, expect, it } from 'vitest';
import { latestOnly } from '../../src/frontend/lib/latest.ts';

describe('latestOnly', () => {
  it('a superseded call resolves undefined; the latest call resolves its own value', async () => {
    const resolvers: (() => void)[] = [];
    const wrapped = latestOnly(
      (tag: string) =>
        new Promise<string>((resolve) => {
          resolvers.push(() => {
            resolve(tag);
          });
        }),
    );

    const first = wrapped('first');
    const second = wrapped('second');

    // The first call's underlying promise resolves after the second call has already started,
    // simulating a slow response that arrives after a newer request was already issued.
    resolvers[1]?.();
    resolvers[0]?.();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe('second');
  });
});
