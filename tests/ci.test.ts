import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CI = readFileSync('.github/workflows/ci.yml', 'utf8');
const CODEQL = readFileSync('.github/workflows/codeql.yml', 'utf8');
const RELEASE = readFileSync('.github/workflows/release.yml', 'utf8');

/** One job's lines, from `  <id>:` up to the next two-space-indented key. No YAML dependency. */
function jobBlock(text: string, id: string): string {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) throw new Error(`job ${id} not found`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('CI', () => {
  it("the stack suite runs as two jobs that don't wait on each other: Stack (WordPress) and Stack (n8n)", () => {
    const wp = jobBlock(CI, 'stack-wp');
    const n8n = jobBlock(CI, 'stack-n8n');
    expect(wp).toContain('    name: Stack (WordPress)');
    expect(n8n).toContain('    name: Stack (n8n)');
    expect(wp).not.toMatch(/^ {4}needs:/m);
    expect(n8n).not.toMatch(/^ {4}needs:/m);
    expect(wp).toContain('run: pnpm run test:stack:wp');
    expect(n8n).toContain('run: pnpm run test:stack:n8n');
    expect(wp).toContain('if: always()');
    expect(n8n).toContain('if: always()');
  });

  it('only Stack (WordPress) checks the translation files, and only Stack (n8n) copies config.json and runs pnpm run setup', () => {
    const wp = jobBlock(CI, 'stack-wp');
    const n8n = jobBlock(CI, 'stack-n8n');
    expect(wp).toContain('pnpm run i18n -- --check');
    expect(n8n).not.toContain('pnpm run i18n');
    expect(n8n).toContain('cp config/config.example.json config/config.json');
    expect(n8n).toContain('run: pnpm run setup');
    expect(wp).not.toContain('config.json');
    expect(wp).not.toContain('pnpm run setup');
    expect(wp).toContain('docker compose up -d --wait db wordpress wpcli\n');
  });

  it('the Stack gate fails unless both halves succeeded', () => {
    const gate = jobBlock(CI, 'stack');
    expect(gate).toContain('    name: Stack\n');
    expect(gate).toContain('    needs: [stack-wp, stack-n8n]');
    expect(gate).toContain('    if: ${{ always() }}');
    expect(gate).toContain('WP_RESULT: ${{ needs.stack-wp.result }}');
    expect(gate).toContain('N8N_RESULT: ${{ needs.stack-n8n.result }}');

    const run = /^ {8}run: (.+)$/m.exec(gate)?.[1];
    if (run === undefined) throw new Error('the Stack gate has no one-line run step');
    // Template expressions stay in env, never in the script, so nothing is injected into bash.
    expect(run).not.toContain('${{');

    const results = ['success', 'failure', 'cancelled', 'skipped'];
    for (const wp of results) {
      for (const n8n of results) {
        let exitCode = 0;
        try {
          execFileSync('bash', ['-c', run], { env: { PATH: process.env['PATH'] ?? '', WP_RESULT: wp, N8N_RESULT: n8n }, stdio: 'ignore' });
        } catch {
          exitCode = 1;
        }
        expect(exitCode, `${wp}/${n8n}`).toBe(wp === 'success' && n8n === 'success' ? 0 : 1);
      }
    }
  });

  it('exactly one job is named Stack, the check the rulesets require', () => {
    expect(CI.match(/^ {4}name: Stack$/gm)).toHaveLength(1);
  });

  it('CodeQL analyzes javascript-typescript and actions', () => {
    expect(CODEQL).toMatch(/^ {10}languages: javascript-typescript, actions$/m);
  });

  it('test:stack:n8n scopes the stack config to tests/stack/n8n', () => {
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['test:stack:n8n']).toBe('vitest run --config vitest.stack.config.ts tests/stack/n8n');
  });
});

describe('release', () => {
  it('releases only a merged release: PR from develop or a release/ branch', () => {
    const condition = jobBlock(RELEASE, 'release').split('\n').find((line) => line.trim().startsWith('if:'));
    expect(condition).toContain("github.event.pull_request.head.ref == 'develop'");
    expect(condition).toContain("startsWith(github.event.pull_request.head.ref, 'release/')");
  });

  /** The `run: |` script, dedented. */
  function releaseScript(): string {
    const lines = RELEASE.split('\n');
    const start = lines.findIndex((line) => line.trim() === 'run: |');
    return lines
      .slice(start + 1)
      .map((line) => line.slice(10))
      .join('\n');
  }

  it.each([
    ['v1.1.0', 'release: v1.1.0', 1, ''],
    ['v1.1.0', 'release: v1.0.9', 1, ''],
    ['v1.9.0', 'release: v1.10.0', 0, 'v1.10.0'],
    ['', 'release: v1.0.0', 0, 'v1.0.0'],
    ['v1.1.0', 'release: no version', 0, ''],
    ['', 'release: v1.0.0', 1, '', 'gh: HTTP 502'],
  ])('the release script with latest %j and title %j exits %i and creates %j (API error %j)', (latest, title, code, created, apiError = '') => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    const log = join(dir, 'gh.log');
    writeFileSync(join(dir, 'gh'), '#!/bin/sh\nif [ "$1" = "api" ]; then\n  if [ -n "$FAKE_API_ERROR" ]; then echo "$FAKE_API_ERROR" >&2; exit 1; fi\n  if [ -z "$FAKE_LATEST" ]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi\n  echo "$FAKE_LATEST"\nelse echo "$@" >> "$GH_LOG"; fi\n');
    chmodSync(join(dir, 'gh'), 0o755);
    writeFileSync(log, '');
    const result = spawnSync('bash', ['-c', releaseScript()], {
      env: { PATH: `${dir}:${process.env['PATH'] ?? ''}`, REPO: 'o/r', SHA: 'abc', TITLE: title, FAKE_LATEST: latest, FAKE_API_ERROR: apiError, GH_LOG: log },
      encoding: 'utf8',
    });
    expect(result.status, result.stdout + result.stderr).toBe(code);
    const logged = readFileSync(log, 'utf8');
    if (created === '') expect(logged).toBe('');
    else expect(logged).toContain(`release create ${created} `);
  });
});
