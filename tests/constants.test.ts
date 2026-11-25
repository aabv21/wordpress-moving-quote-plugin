import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const SCOPE = ['plugin/moving-quote/src', 'plugin/moving-quote/templates', 'plugin/moving-quote/moving-quote.php', 'site/mu-plugins', 'site/theme', 'src', 'scripts'];

async function filesWithLiteral(literal: string): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)('git', ['grep', '-l', '-F', '-e', `'${literal}'`, '-e', `"${literal}"`, '--', ...SCOPE, ':!*.po', ':!*.pot']);
    return stdout.split('\n').filter(Boolean).sort();
  } catch (error) {
    // git grep exits 1 when nothing matches
    if ((error as { code?: number }).code === 1) return [];
    throw error;
  }
}

test('names the business time zone and currency once per language', async () => {
  expect(await filesWithLiteral('America/Bogota')).toEqual(['plugin/moving-quote/src/Plugin.php', 'src/nodes/locale.ts']);
  expect(await filesWithLiteral('COP')).toEqual(['plugin/moving-quote/src/Pricing/Estimate.php', 'src/nodes/locale.ts']);
});
