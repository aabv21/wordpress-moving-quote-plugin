import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { DateTime } from 'luxon';

/**
 * Mirrors `@n8n/task-runner`'s `createVmExecutableCode`: a function body with `$input` and
 * `DateTime` in scope, and `Object.defineProperty` replaced with a no-op first.
 */
export function runJsCode(jsCode: string, input: unknown): unknown {
  const item = { json: input };
  // Object isn't passed in: the new realm has its own, so freezing it there leaves this test
  // run's Object.defineProperty intact.
  const sandbox = {
    $input: { first: () => item, all: () => [item] },
    DateTime,
  };
  return runInNewContext(`Object.defineProperty = () => ({});\n(function () {\n${jsCode}\n})()`, sandbox) as unknown;
}

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
