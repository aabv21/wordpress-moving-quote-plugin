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
