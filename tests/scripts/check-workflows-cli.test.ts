import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

// Runs the real CLI entry point (not just checkWorkflow directly), so this covers main()'s own
// wiring: the real, empty CODE_NODES manifest, not a fixture-scoped one. Every fixture using the
// "Double value" Code node therefore also reports "has no source in the manifest" here, on top of
// whatever defect each fixture is named for — there is no manifest entry for a node named "Double
// value" in any real workflow, only in the checkWorkflow() unit tests, which pass their own
// fixture-scoped codeNodes list per call.
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
  // stale-code.json is byte-identical to clean.json: its jsCode already starts with "// Why
  // Code:", so this check rule never sees it as stale. Only `build:workflows -- --check` (which
  // compares jsCode against a fresh build of the manifest's source) can tell the two apart.
  expect(lines('stale-code')).toEqual(['tests/fixtures/workflows/stale-code.json: code node Double value has no source in the manifest']);
});
it('passes clean and exits 0 over an empty workflows/ directory', () => {
  expect(run('workflows')).toEqual({ stdout: '', status: 0 });
});
