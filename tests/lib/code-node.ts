import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DateTime } from 'luxon';

/**
 * Runs a generated Code node's `jsCode` the way n8n's real Task Runner sandbox does: as a
 * function body, with `$input` and `DateTime` in scope, and `Object.defineProperty` replaced with
 * a no-op before the code runs. That mirrors `@n8n/task-runner`'s `createVmExecutableCode`, so
 * every test here proves the bundle runs the way the real runner runs it, not just in an
 * unfrozen vm.
 */
export function runJsCode(jsCode: string, input: unknown): unknown {
  const item = { json: input };
  // Object is deliberately not passed into the sandbox: runInNewContext gives the context its
  // own fresh global realm, so a bare `Object` inside the run script resolves to that context's
  // own Object constructor, not this process's. Mutating `Object.defineProperty` there mirrors
  // n8n's real sandbox (which freezes its own realm's Object), without corrupting this test run's
  // own Object.defineProperty.
  const sandbox = {
    $input: { first: () => item, all: () => [item] },
    DateTime,
  };
  return runInNewContext(`Object.defineProperty = () => ({});\n(function () {\n${jsCode}\n})()`, sandbox) as unknown;
}

/** Runs the named node's `jsCode` from a workflow file already built into `workflows/`. */
export function runCodeNode(workflowFile: string, nodeName: string, input: unknown): unknown {
  const wf = JSON.parse(readFileSync(`workflows/${workflowFile}`, 'utf8')) as {
    nodes: { name: string; parameters: Record<string, unknown> }[];
  };
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`node ${nodeName} not found in ${workflowFile}`);
  const jsCode = node.parameters.jsCode;
  if (typeof jsCode !== 'string') throw new Error(`node ${nodeName} in ${workflowFile} has no jsCode`);
  return runJsCode(jsCode, input);
}
