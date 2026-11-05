import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

// Runs the real CLI with the real manifest, so every fixture using the "Double value" Code node
// also reports "has no source in the manifest": only the unit tests pass a fixture manifest.
function run(dir: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', ['scripts/check-workflows.ts', dir], { encoding: 'utf8' });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? '', status: e.status ?? 1 };
  }
}

it('exits 1 over the fixture directory, with one line per actual violation', () => {
  const { stdout, status } = run('tests/fixtures/workflows');
  expect(status).toBe(1);

  const lines = (file: string) => stdout.split('\n').filter((l) => l.startsWith(`tests/fixtures/workflows/${file}.json:`));
  expect(lines('leaky')).toEqual([
    'tests/fixtures/workflows/leaky.json: code node Double value has no source in the manifest',
    'tests/fixtures/workflows/leaky.json: literal email in node Send email',
    'tests/fixtures/workflows/leaky.json: literal phone in node Send email',
    'tests/fixtures/workflows/leaky.json: secret-like value in node Send email',
  ]);
  expect(lines('volatile')).toEqual([
    'tests/fixtures/workflows/volatile.json: pinData present',
    'tests/fixtures/workflows/volatile.json: meta.instanceId present',
    'tests/fixtures/workflows/volatile.json: code node Double value has no source in the manifest',
  ]);
  // stale-code.json equals clean.json here; only `build:workflows -- --check` sees it as stale.
  expect(lines('stale-code')).toEqual(['tests/fixtures/workflows/stale-code.json: code node Double value has no source in the manifest']);
});
it('passes clean and exits 0 over an empty workflows/ directory', () => {
  expect(run('workflows')).toEqual({ stdout: '', status: 0 });
});
