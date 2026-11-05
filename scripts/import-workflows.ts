import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compose, loadDotEnv } from './lib/compose.ts';
import { waitForHealthy, waitForWebhookAuthProtected } from './lib/health.ts';
import { listJsonFiles } from './lib/list-json-files.ts';
import { WORKFLOWS, type WorkflowEntry } from './lib/manifest.ts';

const WORKFLOWS_DIR = 'workflows';

/** Adds the command's stdout: n8n's CLI prints its error detail there, not to stderr. */
function errorDetail(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const stdout = (err as { stdout?: unknown }).stdout;
  return typeof stdout === 'string' && stdout.trim() !== '' ? `${err.message}\n${stdout.trim()}` : err.message;
}

export function missingWorkflowIds(manifestIds: readonly string[], seenIds: ReadonlySet<string>): string[] {
  return manifestIds.filter((id) => !seenIds.has(id));
}

async function seenWorkflowIds(): Promise<Set<string>> {
  const { stdout } = await compose(['exec', '-T', 'n8n', 'n8n', 'list:workflow', '--onlyId']);
  return new Set(stdout.split('\n').map((line) => line.trim()).filter((line) => line !== ''));
}

/**
 * Verifies each manifest id landed and retries once: `import:workflow` can exit 0 having skipped a
 * file still settling onto the bind mount.
 */
async function importAndVerify(manifestIds: readonly string[]): Promise<void> {
  await compose(['exec', '-T', 'n8n', 'n8n', 'import:workflow', '--separate', '--input=/workflows']);

  let missing = missingWorkflowIds(manifestIds, await seenWorkflowIds());
  if (missing.length === 0) return;

  await compose(['exec', '-T', 'n8n', 'n8n', 'import:workflow', '--separate', '--input=/workflows']);
  missing = missingWorkflowIds(manifestIds, await seenWorkflowIds());
  if (missing.length > 0) {
    throw new Error(`import:workflow did not bring in: ${missing.join(', ')} (checked twice)`);
  }
}

export async function importWorkflows(): Promise<void> {
  loadDotEnv();

  const hasFiles = listJsonFiles(WORKFLOWS_DIR).length > 0;
  if (hasFiles) {
    await importAndVerify(WORKFLOWS.map((entry) => entry.id));
  }

  let publishedCount = 0;
  const published: WorkflowEntry[] = [];
  const failures: string[] = [];
  for (const entry of WORKFLOWS) {
    const path = join(WORKFLOWS_DIR, entry.file);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is WORKFLOWS_DIR + a manifest file name, not user input
    if (!existsSync(path)) {
      console.log(`skip ${entry.file} (missing)`);
      continue;
    }

    if (!entry.publish) continue;

    try {
      await compose(['exec', '-T', 'n8n', 'n8n', 'publish:workflow', `--id=${entry.id}`]);
      publishedCount += 1;
      published.push(entry);
    } catch (err) {
      failures.push(`publish failed for ${entry.file}: ${errorDetail(err)}`);
    }
  }

  if (publishedCount > 0) {
    await compose(['restart', 'n8n']);
    const n8nUrl = process.env.N8N_URL;
    const healthy = n8nUrl ? await waitForHealthy(n8nUrl, 90_000) : false;
    if (!healthy) {
      failures.push('n8n did not become healthy after restart');
    } else {
      // /healthz is up before the reconciler syncs workflow_published_version (every 10 s by
      // default, N8N_WORKFLOW_PUBLICATION_RECONCILE_INTERVAL_SECONDS). The wait outlasts that
      // default, not a slower one.
      await new Promise<void>((resolve) => setTimeout(resolve, 15_000));

      if (n8nUrl) {
        for (const entry of published) {
          if (!entry.webhookPath) continue;
          const live = await waitForWebhookAuthProtected(n8nUrl, entry.webhookPath, 60_000);
          if (!live) failures.push(`webhook for ${entry.file} never answered 401 (published trigger may not be live)`);
        }
      }
    }
  }

  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  importWorkflows().catch((err: unknown) => {
    console.error(errorDetail(err));
    process.exitCode = 1;
  });
}
