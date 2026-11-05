import type { WorkflowJson } from './workflow-types.ts';

// Instance-specific fields stripped from every export, so a second import/export round trip
// produces no diff.
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
