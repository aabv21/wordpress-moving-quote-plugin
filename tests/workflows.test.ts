import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, it } from 'vitest';
import { checkWorkflow } from '../scripts/check-workflows.ts';
import { buildWorkflows } from '../scripts/build-workflows.ts';
import { listJsonFiles } from '../scripts/lib/list-json-files.ts';
import { CODE_NODES, CREDENTIALS } from '../scripts/lib/manifest.ts';
import type { WorkflowJson } from '../scripts/lib/workflow-types.ts';

// Tasks 11-12 add the committed workflow JSON; this file exercises whatever is actually there
// today so it stays meaningful (and starts failing loudly) the moment a workflow file lands
// without the manifest entries it needs.
const credentialIds = new Set(CREDENTIALS.map((c) => c.id));

it('every file in workflows/ passes the hygiene check', () => {
  for (const path of listJsonFiles('workflows')) {
    const wf = JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
    expect(checkWorkflow(wf, { file: basename(path), credentialIds, codeNodes: CODE_NODES }), path).toEqual([]);
  }
});
it('every Code node in workflows/ matches its committed manifest source', async () => {
  expect((await buildWorkflows({ check: true, workflowsDir: 'workflows', entries: CODE_NODES })).drifted).toEqual([]);
});
