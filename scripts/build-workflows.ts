import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { CODE_NODES, type CodeNodeEntry } from './lib/manifest.ts';
import type { WorkflowJson } from './lib/workflow-types.ts';

// n8n's Task Runner (@n8n/task-runner's createVmExecutableCode) sets `Object.defineProperty =
// () => ({})` before running jsCode. esbuild's IIFE attaches exports through `__defProp`, so every
// export would vanish and `__node.run` would be undefined; a plain assignment sidesteps it.
// NOTE: this patches esbuild's codegen at its exact pinned version. If a newer esbuild changes the
// helper, the guard below throws; update the needle and replacement together.
const ESBUILD_DEFINE_PROP = 'var __defProp = Object.defineProperty;';
const HARDENED_DEFINE_PROP =
  'var __defProp = (obj, key, desc) => { obj[key] = desc && "get" in desc ? desc.get() : desc.value; return obj; };';

export function hardenAgainstFrozenDefineProperty(bundle: string): string {
  if (!bundle.includes(ESBUILD_DEFINE_PROP)) {
    throw new Error("esbuild output didn't contain the expected __defProp assignment; esbuild's codegen may have changed");
  }
  return bundle.replace(ESBUILD_DEFINE_PROP, HARDENED_DEFINE_PROP);
}

async function bundleSource(source: string): Promise<string> {
  const result = await build({
    entryPoints: [source],
    bundle: true,
    format: 'iife',
    globalName: '__node',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    charset: 'utf8',
    legalComments: 'none',
    absWorkingDir: process.cwd(),
  });
  const [output] = result.outputFiles;
  if (!output) throw new Error(`esbuild produced no output for ${source}`);
  return hardenAgainstFrozenDefineProperty(output.text);
}

export async function buildCodeNode(entry: CodeNodeEntry): Promise<string> {
  const header = `// Why Code: ${entry.why}. Generated from ${entry.source} by pnpm run build:workflows; edit the source.`;
  const footer = 'return [{ json: __node.run($input.first().json) }];';
  const bundle = await bundleSource(entry.source);
  return `${header}\n${bundle.trim()}\n${footer}\n`;
}

function readWorkflow(path: string): WorkflowJson {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is dir + a manifest file name, not user input
  return JSON.parse(readFileSync(path, 'utf8')) as WorkflowJson;
}

function writeWorkflow(path: string, wf: WorkflowJson): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is dir + a manifest file name, not user input
  writeFileSync(path, `${JSON.stringify(wf, null, 2)}\n`);
}

export async function buildWorkflows(o: {
  check: boolean;
  workflowsDir: string;
  entries: readonly CodeNodeEntry[];
}): Promise<{ drifted: string[]; skipped: string[] }> {
  const drifted: string[] = [];
  const skipped: string[] = [];

  const byFile = new Map<string, CodeNodeEntry[]>();
  for (const entry of o.entries) {
    const entries = byFile.get(entry.file) ?? [];
    entries.push(entry);
    byFile.set(entry.file, entries);
  }

  for (const [file, entries] of byFile) {
    const path = join(o.workflowsDir, file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is workflowsDir + a manifest file name, not user input
    if (!existsSync(path)) {
      skipped.push(file);
      continue;
    }

    const wf = readWorkflow(path);
    let dirty = false;
    for (const entry of entries) {
      const node = wf.nodes.find((n) => n.name === entry.node);
      if (!node) throw new Error(`node ${entry.node} missing from ${file}`);

      const jsCode = await buildCodeNode(entry);
      const label = `${file} › ${entry.node}`;
      if (node.parameters.jsCode === jsCode) continue;

      drifted.push(label);
      if (!o.check) {
        node.parameters.jsCode = jsCode;
        node.notes = `Why Code: ${entry.why}`;
        dirty = true;
      }
    }
    if (dirty) writeWorkflow(path, wf);
  }

  return { drifted, skipped };
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const result = await buildWorkflows({ check, workflowsDir: 'workflows', entries: CODE_NODES });
  for (const file of result.skipped) console.log(`skip ${file} (missing)`);
  for (const label of result.drifted) console.log(`drift ${label}`);
  if (check && result.drifted.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
