import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflows } from './build-workflows.ts';
import { compose, loadDotEnv } from './lib/compose.ts';
import { listJsonFiles } from './lib/list-json-files.ts';
import { CODE_NODES, WORKFLOWS } from './lib/manifest.ts';
import { normalizeWorkflow } from './lib/normalize-workflow.ts';
import type { WorkflowJson } from './lib/workflow-types.ts';

const EXPORT_DIR = '.n8n-import/export';
const WORKFLOWS_DIR = 'workflows';

function isExecError(err: unknown): err is { stdout: string } {
  return typeof err === 'object' && err !== null && typeof (err as { stdout?: unknown }).stdout === 'string';
}

function readWorkflow(path: string): WorkflowJson {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path comes from listJsonFiles over EXPORT_DIR, not user input
  return JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
}

function writeWorkflow(path: string, wf: WorkflowJson): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is WORKFLOWS_DIR + a manifest file name, not user input
  writeFileSync(path, `${JSON.stringify(wf, null, 2)}\n`);
}

export async function exportWorkflows(): Promise<void> {
  loadDotEnv();

  // EXPORT_DIR is a scratch subdirectory this function owns entirely (never the `.n8n-import/`
  // mount root itself, which is a live bind mount other tooling also writes to), so recreating it
  // from scratch here is safe.
  rmSync(EXPORT_DIR, { recursive: true, force: true });
  mkdirSync(EXPORT_DIR, { recursive: true });
  try {
    await compose(['exec', '-T', 'n8n', 'n8n', 'export:workflow', '--all', '--separate', '--pretty', '--output=/import/export/']);
  } catch (err) {
    // A brand-new instance with nothing imported yet errors instead of exporting zero files.
    if (!isExecError(err) || !/No workflows found/i.test(err.stdout)) throw err;
  }

  const byId = new Map(WORKFLOWS.map((entry) => [entry.id, entry]));
  for (const file of listJsonFiles(EXPORT_DIR)) {
    const wf = readWorkflow(file);
    const entry = byId.get(wf.id);
    if (!entry) {
      console.warn(`exported workflow ${wf.id} is not in the manifest`);
      continue;
    }
    writeWorkflow(join(WORKFLOWS_DIR, entry.file), normalizeWorkflow(wf));
  }

  const { drifted } = await buildWorkflows({ check: false, workflowsDir: WORKFLOWS_DIR, entries: CODE_NODES });
  for (const label of drifted) console.log(`regenerated ${label} (edit the source, not the n8n editor)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  exportWorkflows().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
