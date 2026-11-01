import type { WorkflowJson } from './workflow-types.ts';

// Fields n8n sets on every export that are never meaningful diff material: pinned test data,
// server-assigned bookkeeping, and the exporting instance's own identity. Importing and exporting
// the same workflows twice in a row must produce no diff.
const VOLATILE_FIELDS = [
  'pinData',
  'versionId',
  'activeVersionId',
  'versionCounter',
  'triggerCount',
  'createdAt',
  'updatedAt',
  'shared',
  'staticData',
  'isArchived',
  'active',
  'parentFolderId',
] as const;

export function normalizeWorkflow(wf: WorkflowJson): WorkflowJson {
  const clone: Record<string, unknown> = structuredClone(wf);
  for (const field of VOLATILE_FIELDS) Reflect.deleteProperty(clone, field);
  const meta = clone.meta;
  if (meta !== null && typeof meta === 'object') Reflect.deleteProperty(meta, 'instanceId');
  return clone as WorkflowJson;
}
