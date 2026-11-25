import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

function readBlueprint(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

it('both blueprint files parse as JSON', () => {
  expect(() => readBlueprint('playground/blueprint.json')).not.toThrow();
  expect(() => readBlueprint('playground/blueprint.local.json')).not.toThrow();
});

it('every step but the first two is identical between the public and local blueprints', () => {
  const pub = readBlueprint('playground/blueprint.json');
  const local = readBlueprint('playground/blueprint.local.json');

  const pubSteps = pub.steps as unknown[];
  const localSteps = local.steps as unknown[];

  expect(pubSteps.slice(2)).toEqual(localSteps.slice(2));
});

/** The theme folder in this repo, installed under the name `setup.sh` activates. */
const INSTALL_THEME = {
  step: 'installTheme',
  themeData: {
    resource: 'git:directory',
    url: 'https://github.com/aabv21/wordpress-moving-quote-plugin',
    ref: 'main',
    refType: 'branch',
    path: 'site/theme',
  },
  options: { activate: true, targetFolderName: 'chivabox' },
};

it('the public blueprints install the theme from site/theme in the GitHub repo', () => {
  for (const path of ['playground/blueprint.json', 'playground/blueprint.es.json']) {
    const steps = readBlueprint(path).steps as unknown[];
    expect(steps[1], path).toEqual(INSTALL_THEME);
  }
});

it('the local blueprint activates the mounted theme', () => {
  const steps = readBlueprint('playground/blueprint.local.json').steps as unknown[];
  expect(steps[1]).toEqual({ step: 'activateTheme', themeFolderName: 'chivabox' });
});

it('every page step writes a chivabox pattern reference', () => {
  for (const path of ['playground/blueprint.json', 'playground/blueprint.local.json', 'playground/blueprint.es.json']) {
    const steps = readBlueprint(path).steps as { step: string; command?: string[] }[];
    const pages = steps.filter((step) => step.command?.includes('--post_type=page'));
    expect(pages.length, path).toBe(5);
    for (const step of pages) {
      const content = step.command?.find((arg) => arg.startsWith('--post_content='));
      expect(content, path).toMatch(/^--post_content=<!-- wp:pattern \{"slug":"chivabox\/[a-z-]+"\} \/-->$/);
    }
  }
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

it('both blueprints land on the home page and target PHP 8.3', () => {
  for (const path of ['playground/blueprint.json', 'playground/blueprint.local.json']) {
    const blueprint = readBlueprint(path);
    expect(blueprint.landingPage, path).toBe('/');
    expect((blueprint.preferredVersions as Record<string, unknown>).php, path).toBe('8.3');
  }
});

/** Masks a step's language-specific copy (titles, page content, the tagline), leaving only its shape. */
function shape(step: unknown): unknown {
  return JSON.parse(
    JSON.stringify(step)
      .replace(/"--post_(title|content|excerpt)=(?:[^"\\]|\\.)*"/g, '"--post_$1=…"')
      .replace(/"blogdescription":"(?:[^"\\]|\\.)*"/g, '"blogdescription":"…"'),
  ) as unknown;
}

/** Every `name="value"` line in that locale's branch of `setup.sh`'s `load_copy()`. */
function setupCopy(locale: string): Record<string, string> {
  const lines = readFileSync('setup.sh', 'utf8').split('\n');
  const start = lines.indexOf(`    ${locale})`, lines.indexOf('load_copy() {'));
  if (start === -1) throw new Error(`no ${locale} branch in setup.sh's load_copy()`);
  const end = lines.indexOf('      ;;', start);
  const branch = lines.slice(start + 1, end).join('\n');
  return Object.fromEntries([...branch.matchAll(/^ {6}(\w+)="(.*)"$/gm)].map((match) => [match[1]!, match[2]!]));
}

it('the Spanish blueprint installs the same plugin and theme, switches the site language, then builds the same site', () => {
  const pub = readBlueprint('playground/blueprint.json');
  const es = readBlueprint('playground/blueprint.es.json');
  const pubSteps = pub.steps as unknown[];
  const esSteps = es.steps as unknown[];

  expect(esSteps.slice(0, 2)).toEqual(pubSteps.slice(0, 2));
  expect(esSteps[2]).toEqual({ step: 'setSiteLanguage', language: 'es_CO' });
  expect(esSteps.slice(3).map(shape)).toEqual(pubSteps.slice(2).map(shape));
  expect(es.landingPage).toBe(pub.landingPage);
  expect(es.preferredVersions).toEqual(pub.preferredVersions);
});

it.each([
  ['en_US', 'playground/blueprint.json'],
  ['es_CO', 'playground/blueprint.es.json'],
])("each blueprint carries setup.sh's own %s copy", (locale, path) => {
  const blueprint = readFileSync(path, 'utf8');
  const copy = setupCopy(locale);
  expect(Object.keys(copy).length).toBeGreaterThanOrEqual(10);
  for (const [name, text] of Object.entries(copy)) expect(blueprint, `${name} in ${path}`).toContain(text);
});

/** The key and value pairs `setup.sh` passes to `seed_business_details`. */
function setupBusinessDetails(): [string, string][] {
  const setup = readFileSync('setup.sh', 'utf8');
  return [...setup.matchAll(/^ {2}(business_\w+) "(.*)"(?: \\)?$/gm)].map((match) => [match[1]!, match[2]!]);
}

it.each(['playground/blueprint.json', 'playground/blueprint.local.json', 'playground/blueprint.es.json'])("%s sets setup.sh's business details in one runPHP step", (path) => {
  // Not `wp option patch update`: Playground's wp-cli step reads a `#` in an argument (the street) as a comment.
  const steps = readBlueprint(path).steps as { step: string; code?: string }[];
  const runPhp = steps.filter((step) => step.step === 'runPHP');
  expect(runPhp).toHaveLength(1);
  const details = setupBusinessDetails();
  expect(details).toHaveLength(7);
  for (const [key, value] of details) expect(runPhp[0]?.code, key).toContain(`'${key}' => '${value}'`);
});
