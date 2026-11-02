import { expect, it } from 'vitest';
import { CREDENTIALS, googleCredentialIds } from '../../scripts/lib/manifest.ts';

it('derives exactly the two Google credential ids from the manifest', () => {
  expect(googleCredentialIds(CREDENTIALS).sort()).toEqual(['cvbCredGSheets01', 'cvbCredGmail0001'].sort());
});
