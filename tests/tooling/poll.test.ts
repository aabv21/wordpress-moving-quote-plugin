import { expect, it, vi } from 'vitest';
import { pollForExecutionId } from '../stack/lib/poll.ts';

it('returns the id as soon as the lookup finds exactly one match', async () => {
  const lookup = vi.fn().mockResolvedValue([42]);
  await expect(pollForExecutionId(lookup, 1_000)).resolves.toBe(42);
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('retries while the lookup finds zero matches, until it finds exactly one', async () => {
  const lookup = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([7]);
  await expect(pollForExecutionId(lookup, 1_000, 1)).resolves.toBe(7);
  expect(lookup).toHaveBeenCalledTimes(3);
});

it('throws once the deadline elapses with the lookup still finding zero matches', async () => {
  const lookup = vi.fn().mockResolvedValue([]);
  await expect(pollForExecutionId(lookup, 10, 5)).rejects.toThrow(/did not appear within/);
});

it('throws immediately when the lookup finds more than one match, without retrying', async () => {
  const lookup = vi.fn().mockResolvedValue([1, 2]);
  await expect(pollForExecutionId(lookup, 1_000)).rejects.toThrow(/found 2/);
  expect(lookup).toHaveBeenCalledTimes(1);
});
