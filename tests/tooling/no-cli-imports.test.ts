import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// setup.ts only chains the three CLIs a first run needs, in order.
const ORCHESTRATORS = new Set(['setup.ts']);

test('no script imports another CLI, only scripts/lib', () => {
  const offenders: string[] = [];
  for (const file of readdirSync('scripts').filter((name) => name.endsWith('.ts') && !ORCHESTRATORS.has(name))) {
    const source = readFileSync(`scripts/${file}`, 'utf8');
    for (const match of source.matchAll(/from '\.\/([^']+)'/g)) {
      const target = match[1] ?? '';
      if (!target.startsWith('lib/')) offenders.push(`${file} imports ./${target}`);
    }
  }
  expect(offenders).toEqual([]);
});
