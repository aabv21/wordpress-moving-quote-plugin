import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('.env.example lists every variable compose.yaml and setup.sh read', () => {
  const compose = readFileSync('compose.yaml', 'utf8');
  const setupSh = readFileSync('setup.sh', 'utf8');
  const envExample = readFileSync('.env.example', 'utf8');
  const declared = new Set([...envExample.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));

  // compose.yaml only ever interpolates as `${VAR}`.
  const usedByCompose = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);

  // An uppercase first letter tells an env var from setup.sh's lowercase locals and from `$1`.
  const usedBySetup = [...setupSh.matchAll(/\$\{?([A-Z][A-Z0-9_]*)\}?/g)].map((m) => m[1]);

  const used = [...usedByCompose, ...usedBySetup].filter((name): name is string => name !== undefined);
  expect(used.filter((name) => !declared.has(name))).toEqual([]);
});
