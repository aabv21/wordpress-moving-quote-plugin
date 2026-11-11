import { afterAll, describe, expect, it } from 'vitest';
import { findExecutionIdFor, summarizeErrorHandlerExecution, waitForTerminalStatus } from '../lib/execution-data.ts';
import { buildSignedLeadBody, postSignedLead } from '../lib/signed-lead.ts';
import { googleCredentialsConfigured, sqlApp } from '../lib/stack.ts';

// The case reaches process-lead and the operator alert, so it skips once real Google credentials exist.
const skipForLiveGoogle = await googleCredentialsConfigured();
if (skipForLiveGoogle) {
  console.log('skipping error-handler alert check: a Google credential is configured in n8n (would reach the real sheet and inbox)');
}

const PROCESS_LEAD_WORKFLOW_ID = 'cvbProcessLead01';
const ERROR_HANDLER_WORKFLOW_ID = 'cvbErrorHandler1';

describe.skipIf(skipForLiveGoogle)('error-handler alerts the operator, read-only proof', () => {
  const createdEventIds = new Set<string>();

  afterAll(async () => {
    if (createdEventIds.size === 0) return;
    const quoted = [...createdEventIds].map((id) => `'${id}'`).join(',');
    await sqlApp(`DELETE FROM processed_events WHERE event_id IN (${quoted})`);
    createdEventIds.clear();
  });

  it('a process-lead failure runs error-handler, whose Compose alert names Append lead row in English and reaches Email operator', async () => {
    const { text, requestUuid } = buildSignedLeadBody();
    createdEventIds.add(requestUuid);
    await postSignedLead(text, requestUuid);

    const processLeadId = await findExecutionIdFor(PROCESS_LEAD_WORKFLOW_ID, requestUuid);
    expect(await waitForTerminalStatus(processLeadId, 30_000)).toBe('error');

    // The closing quote of the stored URL string, so execution 42 never matches 420.
    const handlerId = await findExecutionIdFor(ERROR_HANDLER_WORKFLOW_ID, `/executions/${String(processLeadId)}"`, 30_000);
    await waitForTerminalStatus(handlerId, 30_000);

    const summary = await summarizeErrorHandlerExecution(handlerId);
    expect(summary.alert?.to).toBe('ops@example.com');
    expect(summary.alert?.subject).toBe('[Chivabox demo] Workflow failed: Process lead');
    expect(summary.alert?.text).toContain('Failed node: Append lead row');
    // Fails on the missing Gmail credential, which proves the alert reached the send step.
    expect(summary.lastNodeExecuted).toBe('Email operator');
  });
});
