import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isSimpleEmail } from '../../src/nodes/lead.ts';

const CASES = JSON.parse(readFileSync('tests/fixtures/email-cases.json', 'utf8')) as { address: string; valid: boolean }[];

describe('the simple-email rule PHP applies (tests/php/Leads/EmailRuleTest.php reads the same file)', () => {
  it.each(CASES.map((c) => [JSON.stringify(c.address), c.address, c.valid] as const))('%s', (_label, address, valid) => {
    expect(isSimpleEmail(address)).toBe(valid);
  });

  it('isSimpleEmail agrees with every shared email case', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
    expect(CASES.filter((c) => isSimpleEmail(c.address) !== c.valid)).toEqual([]);
  });
});
