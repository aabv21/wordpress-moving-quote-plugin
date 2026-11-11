import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const README = readFileSync('README.md', 'utf8');
const TRACKED = new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter((line) => line !== ''));

describe('README', () => {
  it("README's ## sections follow the design order", () => {
    const sections = README.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
    expect(sections).toEqual(['Video', 'Architecture', 'What it does', 'Quick start', 'Configuration', 'Test scenarios', 'Design decisions', 'Limitations', 'License']);
  });

  it('the quick start has five commands or fewer', () => {
    const quickStart = README.slice(README.indexOf('## Quick start'));
    const block = /```sh\n([\s\S]*?)```/.exec(quickStart)?.[1];
    if (block === undefined) throw new Error('no sh block under Quick start');
    const commands = block.split('\n').filter((line) => line.trim() !== '');
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.length).toBeLessThanOrEqual(5);
  });

  it('the live retry check gives an executable second retry and says each retry resends both emails', () => {
    const retry = README.split('\n').find((line) => line.includes('Rename the `Moving leads` tab'));
    expect(retry).toBeDefined();
    expect(retry).toContain('/api/v1/executions/');
    expect(retry).toContain('/retry');
    expect(retry).toContain('$N8N_API_KEY');
    expect(retry).toMatch(/both emails again/);
  });

  it('the upgrade note tells an existing sheet to add the request_uuid header', () => {
    const upgrade = README.split('\n').find((line) => line.startsWith('**Upgrading an existing stack.**'));
    expect(upgrade).toContain('`request_uuid`');
  });

  it('the README names the settings page as Moving quotes → Settings', () => {
    expect(README).toContain('Moving quotes → Settings');
    expect(README).not.toContain('Settings → Moving Quote Settings');
  });
});

describe('docs links', () => {
  const docs = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', ...[...TRACKED].filter((file) => /^docs\/[^/]+\.md$/.test(file))];

  it('every command the docs give runs as written: no `pnpm test --` (pnpm forwards the --, so Vitest ignores the filter) and no bare vitest', () => {
    const offenders = docs.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${file}:${String(index + 1)}` }))
        .filter(({ line }) => line.includes('`pnpm test -- ') || /then `vitest /.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });

  it('every relative Markdown link in README.md, AGENTS.md and docs/*.md resolves to a tracked file', () => {
    const broken: string[] = [];
    for (const file of docs) {
      const text = readFileSync(file, 'utf8');
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (target === undefined || /^[a-z]+:/.test(target) || target.startsWith('#')) continue;
        const path = normalize(join(dirname(file), target.split('#')[0] ?? ''));
        if (!TRACKED.has(path)) broken.push(`${file}: ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
