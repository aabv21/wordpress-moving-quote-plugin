import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { checkWorkflow, hasPlaceholderInSqlComment } from '../../scripts/check-workflows.ts';
import { normalizeWorkflow } from '../../scripts/lib/normalize-workflow.ts';
import { listJsonFiles } from '../../scripts/lib/list-json-files.ts';
import { CREDENTIALS, ERROR_WORKFLOW_ID } from '../../scripts/lib/manifest.ts';
import type { WorkflowJson } from '../../scripts/lib/workflow-types.ts';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/workflows/${n}.json`, 'utf8')) as WorkflowJson;
const errors = (n: string) =>
  checkWorkflow(fx(n), {
    file: `${n}.json`,
    credentialIds: new Set(CREDENTIALS.map((c) => c.id)),
    codeNodes: [{ file: `${n}.json`, node: 'Double value', source: 'tests/fixtures/nodes/double.ts', why: 'fixture' }],
  }).join('\n');

it('passes a clean workflow', () => expect(errors('clean')).toBe(''));
it('rejects pinned data', () => expect(errors('pinned')).toMatch(/pinData present/));
it('rejects literal email, phone, and secrets', () => {
  const e = errors('leaky');
  expect(e).toMatch(/literal email in node Send email/);
  expect(e).toMatch(/literal phone in node Send email/);
  expect(e).toMatch(/secret-like value in node Send email/);
});
it('rejects unknown credentials', () => expect(errors('bad-credential')).toMatch(/credential nope not in manifest/));
it('requires the Why Code line', () => expect(errors('no-why')).toMatch(/code node Double value must start with \/\/ Why Code:/));
it('rejects Code nodes without a TypeScript source', () => expect(errors('stray-code')).toMatch(/code node Stray code has no source in the manifest/));
it('requires retries on external calls', () => expect(errors('no-retry')).toMatch(/node Send email must retry 3 times with a 1000 ms wait/));
it('requires sticky notes', () => expect(errors('no-sticky')).toMatch(/workflow has no sticky notes/));
it('requires the shared settings', () => {
  const e = errors('bad-settings');
  for (const m of ['executionOrder must be v1', 'timezone must be America/Bogota', 'callerPolicy must be workflowsFromSameOwner', 'errorWorkflow must be cvbErrorHandler1']) {
    expect(e).toContain(m);
  }
});
it('exempts only the error handler itself from the errorWorkflow rule', () => {
  const opts = {
    file: 'clean.json',
    credentialIds: new Set(CREDENTIALS.map((c) => c.id)),
    codeNodes: [{ file: 'clean.json', node: 'Double value', source: 'tests/fixtures/nodes/double.ts', why: 'fixture' }],
  };
  const withoutErrorWorkflow = (id: string): WorkflowJson => ({
    ...fx('clean'),
    id,
    settings: { executionOrder: 'v1', timezone: 'America/Bogota', callerPolicy: 'workflowsFromSameOwner' },
  });
  expect(checkWorkflow(withoutErrorWorkflow(ERROR_WORKFLOW_ID), opts)).toEqual([]);
  expect(checkWorkflow(withoutErrorWorkflow('fixtureCleanWf01'), opts)).toContain('settings.errorWorkflow must be cvbErrorHandler1');
});
it('normalize drops volatile fields and is idempotent', () => {
  const n = normalizeWorkflow(fx('volatile'));
  expect([n.pinData, n.meta?.instanceId, n.versionId, n.staticData]).toEqual([undefined, undefined, undefined, undefined]);
  expect(n.id).toBe(fx('volatile').id);
  expect(normalizeWorkflow(structuredClone(n))).toEqual(n);
});
it('treats a missing directory as empty', () => expect(listJsonFiles('tests/fixtures/does-not-exist')).toEqual([]));
it('rejects a Postgres query built from an expression instead of $n parameters', () => {
  const wf = fx('clean');
  wf.nodes.push({
    id: 'pg1',
    name: 'Insert row',
    type: 'n8n-nodes-base.postgres',
    typeVersion: 2.8,
    position: [600, 0],
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 1000,
    parameters: { operation: 'executeQuery', query: "SELECT '{{ $json.text }}'" },
  });
  const e = checkWorkflow(wf, {
    file: 'clean.json',
    credentialIds: new Set(CREDENTIALS.map((c) => c.id)),
    codeNodes: [{ file: 'clean.json', node: 'Double value', source: 'tests/fixtures/nodes/double.ts', why: 'fixture' }],
  }).join('\n');
  expect(e).toMatch(/query in node Insert row must use \$n parameters, not expressions/);
});
it('rejects a Postgres query that references a $n placeholder from inside a SQL comment', () =>
  expect(errors('sql-comment-placeholder')).toMatch(/query in node Insert row has a \$n placeholder inside a SQL comment/));
it('hasPlaceholderInSqlComment catches a placeholder inside a line comment or a block comment, and ignores one in live SQL', () => {
  expect(hasPlaceholderInSqlComment('-- $1 order_id\nINSERT INTO t (a) VALUES ($1)')).toBe(true);
  expect(hasPlaceholderInSqlComment('/* uses $1 */\nINSERT INTO t (a) VALUES ($1)')).toBe(true);
  expect(hasPlaceholderInSqlComment('INSERT INTO t (a) VALUES ($1)')).toBe(false);
});
