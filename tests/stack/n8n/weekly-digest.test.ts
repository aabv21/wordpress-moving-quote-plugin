import { describe, expect, it } from 'vitest';
import { compose } from '../../../scripts/lib/compose.ts';
import { psqlAs, required } from '../lib/stack.ts';

const WEEKLY_DIGEST_WORKFLOW_ID = 'cvbWeeklyDigest1';

interface ExportedWorkflow {
  settings: { timezone?: string; errorWorkflow?: string };
  nodes: { name: string; parameters: { rule?: { interval: { expression: string }[] } } }[];
}

describe('weekly digest workflow', () => {
  it('publishes the weekly digest, active, with its Monday 08:00 schedule', async () => {
    // Read-only: an export and a query, never an execution (the real one would email the sheet's summary).
    const { stdout } = await compose(['exec', '-T', 'n8n', 'n8n', 'export:workflow', `--id=${WEEKLY_DIGEST_WORKFLOW_ID}`]);
    const [workflow] = JSON.parse(stdout.slice(stdout.indexOf('['))) as ExportedWorkflow[];
    expect(workflow?.settings.timezone).toBe('America/Bogota');
    expect(workflow?.settings.errorWorkflow).toBe('cvbErrorHandler1');
    const trigger = workflow?.nodes.find((node) => node.name === 'Every Monday 08:00');
    expect(trigger?.parameters.rule?.interval[0]?.expression).toBe('0 8 * * 1');

    const active = await psqlAs(required('N8N_DB_USER'), 'n8n', `SELECT ("activeVersionId" IS NOT NULL) FROM workflow_entity WHERE id = '${WEEKLY_DIGEST_WORKFLOW_ID}'`);
    expect(active).toBe('t');
  });
});
