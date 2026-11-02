import { expect, it } from 'vitest';
import { missingWorkflowIds } from '../../scripts/import-workflows.ts';

const manifestIds = ['cvbLeadIntake001', 'cvbProcessLead01', 'cvbErrorHandler1'];

it('reports no missing ids once every manifest id is present', () => {
  expect(missingWorkflowIds(manifestIds, new Set(manifestIds))).toEqual([]);
});

it('reports exactly the manifest ids absent from the seen set, in manifest order', () => {
  expect(missingWorkflowIds(manifestIds, new Set(['cvbLeadIntake001']))).toEqual(['cvbProcessLead01', 'cvbErrorHandler1']);
});

it('ignores an id present in both sets regardless of extra ids seen', () => {
  expect(missingWorkflowIds(manifestIds, new Set([...manifestIds, 'someOtherId0']))).toEqual([]);
});
