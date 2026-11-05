import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

function readBlueprint(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

it('both blueprint files parse as JSON', () => {
  expect(() => readBlueprint('playground/blueprint.json')).not.toThrow();
  expect(() => readBlueprint('playground/blueprint.local.json')).not.toThrow();
});

it('every step but the first is identical between the two blueprints', () => {
  const pub = readBlueprint('playground/blueprint.json');
  const local = readBlueprint('playground/blueprint.local.json');

  const pubSteps = pub.steps as unknown[];
  const localSteps = local.steps as unknown[];

  expect(pubSteps.slice(1)).toEqual(localSteps.slice(1));
});

it('the public blueprint installs the plugin from the GitHub repo', () => {
  const pub = readBlueprint('playground/blueprint.json');
  const steps = pub.steps as Record<string, unknown>[];
  const install = steps[0];

  expect(install).toMatchObject({
    step: 'installPlugin',
    pluginData: {
      resource: 'git:directory',
      url: 'https://github.com/aabv21/wordpress-moving-quote-plugin',
      ref: 'main',
      refType: 'branch',
      path: 'plugin/moving-quote',
    },
    options: {
      activate: true,
      targetFolderName: 'moving-quote',
    },
  });
});

it('the local blueprint activates the mounted plugin instead of installing it', () => {
  const local = readBlueprint('playground/blueprint.local.json');
  const steps = local.steps as Record<string, unknown>[];
  const activate = steps[0];

  expect(activate).toEqual({
    step: 'activatePlugin',
    pluginPath: 'moving-quote/moving-quote.php',
  });
});

it('both blueprints land on the quote page and target PHP 8.3', () => {
  for (const path of ['playground/blueprint.json', 'playground/blueprint.local.json']) {
    const blueprint = readBlueprint(path);
    expect(blueprint.landingPage, path).toBe('/get-a-quote/');
    expect((blueprint.preferredVersions as Record<string, unknown>).php, path).toBe('8.3');
  }
});

/** Masks a step's language-specific copy (titles, page content, the tagline), leaving only its shape. */
function shape(step: unknown): unknown {
  return JSON.parse(
    JSON.stringify(step)
      .replace(/"--post_(title|content)=(?:[^"\\]|\\.)*"/g, '"--post_$1=…"')
      .replace(/"blogdescription":"(?:[^"\\]|\\.)*"/g, '"blogdescription":"…"'),
  ) as unknown;
}

/** Every `name="value"` line in that `SITE_LOCALE`'s `case` branch of `setup.sh`. */
function setupCopy(locale: string): Record<string, string> {
  const lines = readFileSync('setup.sh', 'utf8').split('\n');
  const start = lines.indexOf(`  ${locale})`);
  if (start === -1) throw new Error(`no ${locale} branch in setup.sh`);
  const end = lines.indexOf('    ;;', start);
  const branch = lines.slice(start + 1, end).join('\n');
  return Object.fromEntries([...branch.matchAll(/^ {4}(\w+)="(.*)"$/gm)].map((match) => [match[1]!, match[2]!]));
}

it('the Spanish blueprint installs the same plugin, switches the site language, then builds the same site', () => {
  const pub = readBlueprint('playground/blueprint.json');
  const es = readBlueprint('playground/blueprint.es.json');
  const pubSteps = pub.steps as unknown[];
  const esSteps = es.steps as unknown[];

  expect(esSteps[0]).toEqual(pubSteps[0]);
  expect(esSteps[1]).toEqual({ step: 'setSiteLanguage', language: 'es_CO' });
  expect(esSteps.slice(2).map(shape)).toEqual(pubSteps.slice(1).map(shape));
  expect(es.landingPage).toBe(pub.landingPage);
  expect(es.preferredVersions).toEqual(pub.preferredVersions);
});

it.each([
  ['en_US', 'playground/blueprint.json'],
  ['es_CO', 'playground/blueprint.es.json'],
])("each blueprint carries setup.sh's own %s copy", (locale, path) => {
  const blueprint = readFileSync(path, 'utf8');
  const copy = setupCopy(locale);
  expect(Object.keys(copy).length).toBeGreaterThan(10);
  for (const [name, text] of Object.entries(copy)) expect(blueprint, `${name} in ${path}`).toContain(text);
});
