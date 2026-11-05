import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { compose } from '../../scripts/lib/compose.ts';

// compose(args, { input }) spawns, so these tests mock spawn instead of running docker.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

afterEach(() => {
  vi.clearAllMocks();
});

class FakeStdin extends EventEmitter {
  end(): this {
    return this;
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = new FakeStdin();
}

const mockSpawn = vi.mocked(spawn);

it('a successful exit resolves with the captured stdout and stderr', async () => {
  const fake = new FakeChild();
  mockSpawn.mockReturnValue(fake as never);

  const promise = compose(['exec', '-T', 'n8n', 'sh', '-c', 'cat'], { input: '[]' });
  fake.stdout.emit('data', Buffer.from('imported 0'));
  fake.emit('close', 0);

  await expect(promise).resolves.toEqual({ stdout: 'imported 0', stderr: '' });
});

it('a non-zero exit rejects with the captured stdout and stderr', async () => {
  const fake = new FakeChild();
  mockSpawn.mockReturnValue(fake as never);

  const promise = compose(['exec', '-T', 'n8n', 'sh', '-c', 'cat'], { input: '[]' });
  fake.stdout.emit('data', Buffer.from('partial output'));
  fake.stderr.emit('data', Buffer.from('some warning'));
  fake.emit('close', 1);

  await expect(promise).rejects.toMatchObject({ stdout: 'partial output', stderr: 'some warning' });
  await expect(promise).rejects.toThrow(/some warning/);
});

it('a stdin error, like EPIPE, rejects instead of throwing', async () => {
  const fake = new FakeChild();
  mockSpawn.mockReturnValue(fake as never);

  const promise = compose(['exec', '-T', 'n8n', 'sh', '-c', 'cat'], { input: 'x'.repeat(1_000_000) });
  // Without a stdin 'error' listener, this emit would throw — that's the crash being guarded against.
  const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  fake.stdin.emit('error', epipe);

  await expect(promise).rejects.toThrow(/EPIPE/);
  await expect(promise).rejects.toMatchObject({ stdout: '', stderr: '' });
});

it('a spawn error rejects instead of throwing', async () => {
  const fake = new FakeChild();
  mockSpawn.mockReturnValue(fake as never);

  const promise = compose(['exec', '-T', 'n8n', 'sh', '-c', 'cat'], { input: '[]' });
  fake.emit('error', new Error('ENOENT'));

  await expect(promise).rejects.toThrow('ENOENT');
});

it('without input, compose never spawns (uses execFile instead)', async () => {
  // Real docker isn't stubbed here; only that the stdin-only spawn path is never reached matters.
  await compose(['ls']).catch(() => undefined);
  expect(mockSpawn).not.toHaveBeenCalled();
});
