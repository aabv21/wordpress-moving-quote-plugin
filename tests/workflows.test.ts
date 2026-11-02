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

it('workflows/ is not empty, so the checks below cover something', () => {
  expect(listJsonFiles('workflows').length).toBeGreaterThan(0);
});

it('every file in workflows/ passes the hygiene check', () => {
  for (const path of listJsonFiles('workflows')) {
    const wf = JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
    expect(checkWorkflow(wf, { file: basename(path), credentialIds, codeNodes: CODE_NODES }), path).toEqual([]);
  }
});
it('every Code node in workflows/ matches its committed manifest source', async () => {
  expect((await buildWorkflows({ check: true, workflowsDir: 'workflows', entries: CODE_NODES })).drifted).toEqual([]);
});

it('every workflow in workflows/ pins settings.saveManualExecutions to false, so a manual run from the editor is never stored either', () => {
  for (const path of listJsonFiles('workflows')) {
    const wf = readWorkflow(path);
    expect((wf.settings as { saveManualExecutions?: boolean }).saveManualExecutions, basename(path)).toBe(false);
  }
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

it('every Google Sheets and Gmail node across workflows/ retries 3 times with a 1000 ms wait', () => {
  const matches = [...allNodesOfType('n8n-nodes-base.googleSheets'), ...allNodesOfType('n8n-nodes-base.gmail')];
  expect(matches.length).toBeGreaterThan(0);
  for (const { file, node: n } of matches) {
    expect(n.retryOnFail, `${file} › ${n.name}`).toBe(true);
    expect(n.maxTries, `${file} › ${n.name}`).toBe(3);
    expect(n.waitBetweenTries, `${file} › ${n.name}`).toBe(1000);
  }
});

it('no workflow in workflows/ anchors a cross-node reference with .item', () => {
  for (const path of listJsonFiles('workflows')) {
    const wf = readWorkflow(path);
    for (const n of wf.nodes) {
      const serialized = JSON.stringify(n.parameters);
      expect(serialized, `${basename(path)} › ${n.name}`).not.toMatch(/\$\([^)]*\)\.item\b/);
    }
  }
});

describe('lead-intake.json', () => {
  const wf = readWorkflow('workflows/lead-intake.json');

  it('pins settings.saveDataSuccessExecution to none, so a successful run is soft-deleted for the next hard-delete cycle rather than kept until EXECUTIONS_DATA_MAX_AGE', () => {
    expect((wf.settings as { saveDataSuccessExecution?: string }).saveDataSuccessExecution).toBe('none');
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

  it('wires "Respond accepted" to the fire-and-forget hand-off, with "Prepare lead" anchored on .first()', () => {
    const connections = wf.connections as Record<string, { main: { node: string; type: string; index: number }[][] }>;
    expect(connections['Respond accepted']?.main).toEqual([[{ node: 'Prepare lead', type: 'main', index: 0 }]]);
    expect(connections['Prepare lead']?.main).toEqual([[{ node: 'Process lead', type: 'main', index: 0 }]]);

    const assignments = (node(wf, 'Prepare lead').parameters.assignments as { assignments: { name: string; value: string }[] }).assignments;
    expect(assignments.find((a) => a.name === 'lead')?.value).toBe("={{ $('Verify request').first().json.lead }}");
    expect(assignments.find((a) => a.name === 'config')?.value).toBe("={{ $('Parse config').first().json.config }}");
  });

  it('pins "Process lead" to call cvbProcessLead01 by ID, fire-and-forget', () => {
    const n = node(wf, 'Process lead');
    expect(n.typeVersion).toBe(1.4);
    expect(n.parameters.source).toBe('database');
    expect(n.parameters.workflowId).toEqual({ __rl: true, mode: 'id', value: 'cvbProcessLead01' });
    expect(n.parameters.mode).toBe('each');
    expect((n.parameters.options as { waitForSubWorkflow?: boolean }).waitForSubWorkflow).toBe(false);
  });
});

describe('process-lead.json', () => {
  const wf = readWorkflow('workflows/process-lead.json');

  it('pins "When called" to accept all data with no declared schema', () => {
    const n = node(wf, 'When called');
    expect(n.parameters.inputSource).toBe('passthrough');
  });

  it('pins "Row fields" to JSON mode over $json.row', () => {
    const n = node(wf, 'Row fields');
    expect(n.parameters.mode).toBe('raw');
    expect(n.parameters.jsonOutput).toBe('={{ $json.row }}');
  });

  it('wires every node in order, with no extra fan-out', () => {
    const connections = wf.connections as Record<string, { main: { node: string; type: string; index: number }[][] }>;
    expect(connections).toEqual({
      'When called': { main: [[{ node: 'Map lead', type: 'main', index: 0 }]] },
      'Map lead': { main: [[{ node: 'Row fields', type: 'main', index: 0 }]] },
      'Row fields': { main: [[{ node: 'Append lead row', type: 'main', index: 0 }]] },
      'Append lead row': {
        main: [
          [
            { node: 'Email team', type: 'main', index: 0 },
            { node: 'Email customer', type: 'main', index: 0 },
          ],
        ],
      },
    });
  });

  it('pins "Append lead row": append, autoMapInputData, RAW cell format, handlingExtraData error, and the config-driven document/sheet locators', () => {
    const n = node(wf, 'Append lead row');
    expect(n.parameters.resource).toBe('sheet');
    expect(n.parameters.operation).toBe('append');
    expect(n.parameters.documentId).toEqual({
      __rl: true,
      mode: 'id',
      value: "={{ $('When called').first().json.config.google.leads_sheet_id }}",
    });
    expect(n.parameters.sheetName).toEqual({
      __rl: true,
      mode: 'name',
      value: "={{ $('When called').first().json.config.google.leads_tab }}",
    });
    expect((n.parameters.columns as { mappingMode?: string }).mappingMode).toBe('autoMapInputData');
    expect((n.parameters.options as { cellFormat?: string }).cellFormat).toBe('RAW');
    // The 2.45.6 default ('insertInNewColumn') adds a new column when the sheet's own headers
    // drift from what's sent, silently "repairing" a renamed header instead of failing loudly;
    // 'error' makes a header mismatch fail the node (and alert) instead.
    expect((n.parameters.options as { handlingExtraData?: string }).handlingExtraData).toBe('error');
    expect(n.retryOnFail).toBe(true);
    expect(n.maxTries).toBe(3);
    expect(n.waitBetweenTries).toBe(1000);
  });

  it('pins "Email team" as plain text, anchored on "Map lead"', () => {
    const n = node(wf, 'Email team');
    expect(n.parameters.emailType).toBe('text');
    expect(n.parameters.sendTo).toBe("={{ $('Map lead').first().json.team.to }}");
    expect(n.parameters.subject).toBe("={{ $('Map lead').first().json.team.subject }}");
    expect(n.parameters.message).toBe("={{ $('Map lead').first().json.team.text }}");
    const options = n.parameters.options as { appendAttribution?: boolean; senderName?: string };
    expect(options.appendAttribution).toBe(false);
    expect(options.senderName).toBe("={{ $('Map lead').first().json.sender_name }}");
  });

  it('pins "Email customer" as HTML with a reply-to set to the team address', () => {
    const n = node(wf, 'Email customer');
    expect(n.parameters.emailType).toBe('html');
    expect(n.parameters.sendTo).toBe("={{ $('Map lead').first().json.customer.to }}");
    expect(n.parameters.subject).toBe("={{ $('Map lead').first().json.customer.subject }}");
    expect(n.parameters.message).toBe("={{ $('Map lead').first().json.customer.html }}");
    const options = n.parameters.options as { appendAttribution?: boolean; replyTo?: string; senderName?: string };
    expect(options.appendAttribution).toBe(false);
    expect(options.replyTo).toBe("={{ $('Map lead').first().json.customer.reply_to }}");
    expect(options.senderName).toBe("={{ $('Map lead').first().json.sender_name }}");
  });
});

describe('error-handler.json', () => {
  const wf = readWorkflow('workflows/error-handler.json');

  it('carries no settings.errorWorkflow, so a failure here never loops back into itself', () => {
    expect((wf.settings as { errorWorkflow?: string }).errorWorkflow).toBeUndefined();
  });

  it('pins "Read config" with alwaysOutputData and executeOnce, matching lead-intake\'s own defense in depth', () => {
    const n = node(wf, 'Read config');
    expect(n.alwaysOutputData).toBe(true);
    expect(n.executeOnce).toBe(true);
  });

  it('pins "Email operator" as a plain-text alert anchored on "On workflow error", with optional chaining and fallbacks', () => {
    const n = node(wf, 'Email operator');
    expect(n.parameters.emailType).toBe('text');
    expect(n.parameters.sendTo).toBe('={{ $json.config.alerts.error_email }}');
    expect(n.parameters.subject).toBe(
      "=[Chivabox demo] Workflow failed: {{ (({ workflow }) => workflow?.name ?? 'unknown workflow')($('On workflow error').first().json) }}",
    );
    const message = n.parameters.message as string;
    expect(message).toContain("$('On workflow error').first().json");
    expect(message).toContain('execution?.lastNodeExecuted ?? ');
    expect(message).toContain('execution?.error?.message ?? trigger?.error?.message ?? ');
    expect(message).toContain("execution?.url ?? 'n/a (activation error)'");
    expect(message).toContain("America/Bogota");
  });
});
