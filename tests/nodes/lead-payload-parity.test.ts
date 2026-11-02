import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLead } from '../../src/nodes/lead.ts';

const FIXTURES_DIR = 'tests/fixtures/lead-payloads';

const fixtureNames = readdirSync(FIXTURES_DIR).filter((name) => name.endsWith('.json'));

describe('parseLead accepts every fixture PHP actually emits', () => {
  it('has at least the fixtures the parity corpus requires', () => {
    expect(fixtureNames.length).toBeGreaterThanOrEqual(8);
  });

  it.each(fixtureNames)('accepts %s', (name) => {
    const body: unknown = JSON.parse(readFileSync(`${FIXTURES_DIR}/${name}`, 'utf8'));
    expect(parseLead(body)).not.toBeNull();
  });
});
