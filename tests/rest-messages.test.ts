import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const MESSAGES = readFileSync('plugin/moving-quote/src/Rest/Messages.php', 'utf8');

it('the field messages take every limit from LeadValidator, never a literal number', () => {
  // A digit inside a translatable string would be a hand-written limit; `%1$d` placeholders are fine.
  expect(MESSAGES).not.toMatch(/__\(\s*'[^']*(?<![%$])\d/);
  for (const name of ['NAME_MIN_LEN', 'NAME_MAX_LEN', 'MOVE_DATE_MAX_DAYS_AHEAD']) {
    expect(MESSAGES).toContain(`LeadValidator::${name}`);
  }
});
