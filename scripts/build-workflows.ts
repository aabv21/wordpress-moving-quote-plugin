import { fileURLToPath } from 'node:url';
import { buildWorkflows } from './lib/build.ts';
import { CODE_NODES } from './lib/manifest.ts';

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
