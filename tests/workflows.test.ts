import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWorkflow } from '../scripts/check-workflows.ts';
import { buildWorkflows } from '../scripts/build-workflows.ts';
import { listJsonFiles } from '../scripts/lib/list-json-files.ts';
import { CODE_NODES, CREDENTIALS } from '../scripts/lib/manifest.ts';
import type { WorkflowJson, WorkflowNode } from '../scripts/lib/workflow-types.ts';

// This file exercises whatever workflow JSON is actually committed, so it stays meaningful (and
// starts failing loudly) the moment a workflow file lands without the manifest entries it needs.
const credentialIds = new Set(CREDENTIALS.map((c) => c.id));

function readWorkflow(path: string): WorkflowJson {
  return JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
}

function node(wf: WorkflowJson, name: string): WorkflowNode {
  const found = wf.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`node ${name} not found`);
  return found;
}

/** Every node of `type` across every file in `workflows/`, paired with the file it came from. */
function allNodesOfType(type: string): { file: string; node: WorkflowNode }[] {
  const matches: { file: string; node: WorkflowNode }[] = [];
  for (const path of listJsonFiles('workflows')) {
    const wf = readWorkflow(path);
    for (const n of wf.nodes) {
      if (n.type === type) matches.push({ file: basename(path), node: n });
    }
  }
  return matches;
}

it('every file in workflows/ passes the hygiene check', () => {
  for (const path of listJsonFiles('workflows')) {
    const wf = JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
    expect(checkWorkflow(wf, { file: basename(path), credentialIds, codeNodes: CODE_NODES }), path).toEqual([]);
  }
});
it('every Code node in workflows/ matches its committed manifest source', async () => {
  expect((await buildWorkflows({ check: true, workflowsDir: 'workflows', entries: CODE_NODES })).drifted).toEqual([]);
});

it('every Postgres node across workflows/ is pinned at typeVersion 2.8', () => {
  const matches = allNodesOfType('n8n-nodes-base.postgres');
  expect(matches.length).toBeGreaterThan(0);
  for (const { file, node: n } of matches) {
    expect(n.typeVersion, `${file} › ${n.name}`).toBe(2.8);
  }
});

it('no Execute Workflow node anywhere in workflows/ sets retryOnFail', () => {
  for (const { file, node: n } of allNodesOfType('n8n-nodes-base.executeWorkflow')) {
    expect(n.retryOnFail, `${file} › ${n.name}`).not.toBe(true);
  }
});

describe('lead-intake.json', () => {
  const wf = readWorkflow('workflows/lead-intake.json');

  it('pins settings.saveDataSuccessExecution to none, so a successful run is soft-deleted for the next hard-delete cycle rather than kept until EXECUTIONS_DATA_MAX_AGE', () => {
    expect((wf.settings as { saveDataSuccessExecution?: string }).saveDataSuccessExecution).toBe('none');
  });

  it('pins settings.saveManualExecutions to false, so a manual run from the editor is never stored either', () => {
    expect((wf.settings as { saveManualExecutions?: boolean }).saveManualExecutions).toBe(false);
  });

  it('pins "Receive lead"\'s parameters and its JWT credential', () => {
    const n = node(wf, 'Receive lead');
    expect(n.typeVersion).toBe(2.2);
    expect(n.parameters).toMatchObject({
      httpMethod: 'POST',
      path: 'moving-quote/leads',
      authentication: 'jwtAuth',
      responseMode: 'responseNode',
      options: { rawBody: true },
    });
    expect(n.credentials?.jwtAuth?.id).toBe('cvbCredLeadJwt01');
    expect(n.webhookId).toBe('3b0e6f0a-8f5e-4c2b-9d71-5a2c4e8b1f90');
  });

  it('pins "Hash raw body"\'s parameters, tolerant of UI-dropped defaults', () => {
    const n = node(wf, 'Hash raw body');
    const p = n.parameters as { action?: string; type?: string; binaryData?: boolean; binaryPropertyName?: string; dataPropertyName?: string; encoding?: string };
    expect(p.action).toBe('hash');
    expect(p.type ?? 'SHA256').toBe('SHA256');
    expect(p.binaryData).toBe(true);
    expect(p.binaryPropertyName ?? 'data').toBe('data');
    expect(p.dataPropertyName).toBe('body_sha256');
    expect(p.encoding ?? 'hex').toBe('hex');
  });

  it('pins "Request valid?" to test $json.ok, wired true to Read config and false to Reject request, with no extra fan-out', () => {
    const n = node(wf, 'Request valid?');
    const conditions = (n.parameters.conditions as { conditions: { leftValue: string; operator: unknown }[] }).conditions;
    expect(conditions).toHaveLength(1);
    expect(conditions[0]?.leftValue).toBe('={{ $json.ok }}');
    expect(conditions[0]?.operator).toEqual({ type: 'boolean', operation: 'true', singleValue: true });

    const connections = wf.connections as Record<string, { main: { node: string; type: string; index: number }[][] }>;
    expect(connections['Request valid?']?.main).toEqual([
      [{ node: 'Read config', type: 'main', index: 0 }],
      [{ node: 'Reject request', type: 'main', index: 0 }],
    ]);
  });

  it('pins "Read config" with alwaysOutputData and executeOnce as defense in depth, on top of the node\'s own loud failure on a missing file', () => {
    const n = node(wf, 'Read config');
    expect(n.alwaysOutputData).toBe(true);
    expect(n.executeOnce).toBe(true);
  });

  it('pins "Record request" with alwaysOutputData, so a replay with no RETURNING row still reaches the gate after it', () => {
    const n = node(wf, 'Record request');
    expect(n.alwaysOutputData).toBe(true);
  });

  it('pins "New request?" to test $json.event_id exists, wired true to Respond accepted and false to Respond duplicate, with no extra fan-out', () => {
    const n = node(wf, 'New request?');
    const conditions = (n.parameters.conditions as { conditions: { leftValue: string; operator: unknown }[] }).conditions;
    expect(conditions).toHaveLength(1);
    expect(conditions[0]?.leftValue).toBe('={{ $json.event_id }}');
    expect(conditions[0]?.operator).toEqual({ type: 'string', operation: 'exists', singleValue: true });

    const connections = wf.connections as Record<string, { main: { node: string; type: string; index: number }[][] }>;
    expect(connections['New request?']?.main).toEqual([
      [{ node: 'Respond accepted', type: 'main', index: 0 }],
      [{ node: 'Respond duplicate', type: 'main', index: 0 }],
    ]);
  });
});
