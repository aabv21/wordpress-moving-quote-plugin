import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKFLOWS } from '../scripts/lib/manifest.ts';

const TRACKED = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\n').filter((line) => line !== '');
const MARKDOWN = TRACKED.filter((file) => file.endsWith('.md') && !file.startsWith('.superpowers/') && !file.startsWith('node_modules/'));
const AGENT_DOCS = ['AGENTS.md', 'CONTRIBUTING.md', 'README.md', ...TRACKED.filter((file) => file.startsWith('docs/') && file.endsWith('.md') && file.split('/').length <= 3)];

function phpFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? phpFiles(join(dir, entry.name)) : entry.name.endsWith('.php') ? [join(dir, entry.name)] : []));
}

function mentioning(needle: string): string[] {
  return MARKDOWN.filter((file) => readFileSync(file, 'utf8').includes(needle));
}

describe('agent docs', () => {
  it('AGENTS.md stays under 170 lines and 14,000 bytes', () => {
    const text = readFileSync('AGENTS.md', 'utf8');
    expect(text.split('\n').length).toBeLessThan(170);
    expect(Buffer.byteLength(text)).toBeLessThan(14_000);
  });

  it('docs/api.md documents every REST route, admin-post action and shortcode the plugin registers, and every webhook path', () => {
    const api = readFileSync('docs/api.md', 'utf8');
    const source = phpFiles('plugin/moving-quote/src').map((file) => readFileSync(file, 'utf8')).join('\n');
    const routes = [...source.matchAll(/const ROUTE\s*=\s*'([^']+)'/g)].map((match) => match[1] ?? '');
    const actions = [...source.matchAll(/'admin_post(?:_nopriv)?_([a-z_]+)'/g)].map((match) => match[1] ?? '');
    const tags = [...source.matchAll(/public const TAG\s*=\s*'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(actions.length).toBeGreaterThanOrEqual(4);
    expect(tags.length).toBeGreaterThanOrEqual(6);
    const missing = [
      ...routes.filter((route) => !api.includes(`/wp-json/moving-quote/v1${route}`)),
      ...actions.filter((action) => !api.includes(`\`${action.startsWith('moving_quote') ? action : `moving_quote_${action}`}\``)),
      ...tags.filter((tag) => !api.includes(`[${tag}`)),
      ...WORKFLOWS.flatMap((workflow) => (workflow.webhookPath !== undefined && !api.includes(`/webhook/${workflow.webhookPath}`) ? [workflow.webhookPath] : [])),
    ];
    expect(missing).toEqual([]);
  });

  it('each repeated fact has one owner', () => {
    expect(mentioning('user-visible plugin release')).toEqual(['CONTRIBUTING.md']);
    expect(mentioning('--scale n8n-worker=2')).toEqual(['docs/testing.md']);
    expect(mentioning('received_at reference name phone email')).toEqual(['README.md']);
  });

  it('no em dash in AGENTS.md, CONTRIBUTING.md, README.md or docs/*.md', () => {
    const offenders = AGENT_DOCS.filter((file) => readFileSync(file, 'utf8').includes(' — '));
    expect(offenders).toEqual([]);
  });

  it('no Markdown file points at an AGENTS.md section that no longer exists', () => {
    const headings = new Set(readFileSync('AGENTS.md', 'utf8').split('\n').filter((line) => line.startsWith('#')).map((line) => line.replace(/^#+\s*/, '')));
    const stale: string[] = [];
    for (const file of MARKDOWN) {
      for (const match of readFileSync(file, 'utf8').matchAll(/AGENTS\.md`?'?s?\s+(?:"([^"]+)"|([A-Z][A-Za-z ]+?) section)/g)) {
        const name = match[1] ?? match[2] ?? '';
        if (!headings.has(name)) stale.push(`${file}: ${name}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
