import { execFile } from 'node:child_process';
import { psqlAs, required } from './stack.ts';
import { pollForExecutionId } from './poll.ts';

function runDockerWithInput(args: string[], input: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile('docker', args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err instanceof Error ? err : new Error(err.message));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

/**
 * The one n8n execution for `workflowId`, found by searching `execution_data` for `needle` — the
 * same read-only `position()` match `intake.test.ts` uses to find an execution by its
 * `request_uuid`, never by a token. Polled with a bounded deadline: the sub-execution row is only
 * created once `process-lead` itself starts running, which happens after `lead-intake` has
 * already answered its own caller, so an immediate, single lookup can genuinely miss it.
 */
export async function findExecutionIdFor(workflowId: string, needle: string, deadlineMs = 10_000): Promise<number> {
  const lookup = async (): Promise<number[]> => {
    const rows = await psqlAs(
      required('N8N_DB_USER'),
      'n8n',
      `SELECT id FROM execution_entity WHERE "workflowId"='${workflowId}' AND id IN (SELECT "executionId" FROM execution_data WHERE position('${needle}' IN data) > 0)`,
    );
    return rows.split('\n').filter((line) => line !== '').map(Number);
  };
  return pollForExecutionId(lookup, deadlineMs);
}

/** Polls (read-only) an execution's `status` until it leaves `new`/`running`, or `deadlineMs` elapses. */
export async function waitForTerminalStatus(executionId: number, deadlineMs: number): Promise<string> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const status = (await psqlAs(required('N8N_DB_USER'), 'n8n', `SELECT status FROM execution_entity WHERE id = ${String(executionId)}`)).trim();
    if (status !== 'new' && status !== 'running') return status;
    if (Date.now() >= deadline) throw new Error(`execution ${String(executionId)} did not reach a terminal status within ${String(deadlineMs)} ms (last: ${status})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export interface MapLeadOutputShape {
  rowKeys: string[];
  teamKeys: string[];
  customerKeys: string[];
  /** The two emails' rendered copy, for checking the language each one came out in (test leads only: example.com addresses, invented names). */
  teamSubject: string | null;
  customerSubject: string | null;
  customerHtml: string | null;
}

export interface ProcessLeadExecutionSummary {
  lastNodeExecuted: string | null;
  nodesRun: string[];
  mapLeadOutput: MapLeadOutputShape | null;
  appendLeadRowErrorMessage: string | null;
}

/** Decodes one `process-lead` execution's `flatted`-encoded data (n8n's own bundled package, run inside the `n8n` container) into this small, typed summary — never the raw decoded tree. */
export async function summarizeProcessLeadExecution(executionId: number): Promise<ProcessLeadExecutionSummary> {
  const raw = await psqlAs(required('N8N_DB_USER'), 'n8n', `SELECT data FROM execution_data WHERE "executionId" = ${String(executionId)}`);

  const script = `
const { parse } = require('/usr/local/lib/node_modules/n8n/node_modules/flatted/cjs/index.js');
let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  const data = parse(raw);
  const resultData = data.resultData;
  const runData = resultData.runData;
  const mapLeadRuns = runData['Map lead'];
  let mapLeadOutput = null;
  if (mapLeadRuns && mapLeadRuns.length > 0) {
    const output = mapLeadRuns[0].data.main[0][0].json;
    mapLeadOutput = {
      rowKeys: Object.keys(output.row ?? {}),
      teamKeys: Object.keys(output.team ?? {}),
      customerKeys: Object.keys(output.customer ?? {}),
      teamSubject: output.team?.subject ?? null,
      customerSubject: output.customer?.subject ?? null,
      customerHtml: output.customer?.html ?? null,
    };
  }
  const appendRuns = runData['Append lead row'];
  const appendLeadRowErrorMessage = appendRuns && appendRuns.length > 0 && appendRuns[0].error ? appendRuns[0].error.message : null;
  console.log(JSON.stringify({
    lastNodeExecuted: resultData.lastNodeExecuted ?? null,
    nodesRun: Object.keys(runData),
    mapLeadOutput,
    appendLeadRowErrorMessage,
  }));
});
`;

  const stdout = await runDockerWithInput(['compose', 'exec', '-T', 'n8n', 'node', '-e', script], raw);
  return JSON.parse(stdout) as ProcessLeadExecutionSummary;
}
