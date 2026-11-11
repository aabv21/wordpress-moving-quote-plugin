import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the plugin version', () => {
  it('the plugin header Version, Plugin::VERSION and the plugin\'s composer.json version agree', () => {
    const header = /^ \* Version: (\S+)$/m.exec(readFileSync('plugin/moving-quote/moving-quote.php', 'utf8'))?.[1];
    const constant = /public const VERSION = '([^']+)';/.exec(readFileSync('plugin/moving-quote/src/Plugin.php', 'utf8'))?.[1];
    const composer = (JSON.parse(readFileSync('plugin/moving-quote/composer.json', 'utf8')) as { version?: string }).version;
    expect(header).toMatch(/^\d+\.\d+\.\d+$/);
    expect(constant).toBe(header);
    expect(composer).toBe(header);
  });
});

// Prose names the n8n line, not the patch compose.yaml pins, so a Dependabot patch bump never makes
// the docs wrong. A patch appears only as the version a claim was checked against.
const DOCS = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', ...readdirSync('docs').filter((file) => file.endsWith('.md')).map((file) => `docs/${file}`)];

/** Each `file:line: match` for a global pattern in the docs, unless `allowed` accepts the 40 characters before it. */
function offenders(pattern: RegExp, allowed: (before: string) => boolean = () => false): string[] {
  return DOCS.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(pattern)]
      .filter((match) => !allowed(text.slice(Math.max(0, match.index - 40), match.index)))
      .map((match) => `${file}:${String(text.slice(0, match.index).split('\n').length)}: ${match[0]}`);
  });
}

describe('version wording', () => {
  it('docs name an n8n patch only as the version a claim was checked against', () => {
    expect(offenders(/\b2\.45\.\d+\b/g, (before) => /checked against `?$/.test(before))).toEqual([]);
  });

  it('docs never pin a Redis version', () => {
    expect(offenders(/Redis \d/g)).toEqual([]);
  });
});
