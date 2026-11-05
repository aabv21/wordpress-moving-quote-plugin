import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildCodeNode, buildWorkflows, hardenAgainstFrozenDefineProperty } from '../../scripts/build-workflows.ts';
import { runJsCode } from '../lib/code-node.ts';

const entry = { file: 'clean.json', node: 'Double value', source: 'tests/fixtures/nodes/double.ts', why: 'fixture' };

it('wraps a source as a Code-node body that runs like n8n runs it', async () => {
  const js = await buildCodeNode(entry);
  expect(js.split('\n')[0]).toBe('// Why Code: fixture. Generated from tests/fixtures/nodes/double.ts by pnpm run build:workflows; edit the source.');
  expect(js.trimEnd().endsWith('return [{ json: __node.run($input.first().json) }];')).toBe(true);
  expect(runJsCode(js, { n: 2 })).toEqual([{ json: { n: 4 } }]);
});
it('check mode reports drift without writing, then a build clears it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cvb-build-'));
  cpSync('tests/fixtures/workflows/stale-code.json', join(dir, 'clean.json'));
  const before = readFileSync(join(dir, 'clean.json'), 'utf8');
  expect((await buildWorkflows({ check: true, workflowsDir: dir, entries: [entry] })).drifted).toEqual(['clean.json › Double value']);
  expect(readFileSync(join(dir, 'clean.json'), 'utf8')).toBe(before);
  await buildWorkflows({ check: false, workflowsDir: dir, entries: [entry] });
  expect((await buildWorkflows({ check: true, workflowsDir: dir, entries: [entry] })).drifted).toEqual([]);
});
it('skips entries whose workflow file does not exist yet', async () =>
  expect((await buildWorkflows({ check: true, workflowsDir: 'tests/fixtures/does-not-exist', entries: [entry] })).skipped).toEqual(['clean.json']));
it('generated code still exports run when Object.defineProperty is frozen, like the real n8n Task Runner sandbox', async () => {
  // See hardenAgainstFrozenDefineProperty in scripts/build-workflows.ts.
  const js = await buildCodeNode(entry);
  expect(runJsCode(js, { n: 2 })).toEqual([{ json: { n: 4 } }]);
});
it('hardenAgainstFrozenDefineProperty rejects a bundle without the expected esbuild helper', () =>
  expect(() => hardenAgainstFrozenDefineProperty('var x = 1;')).toThrow(/esbuild output didn't contain/));
