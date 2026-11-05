import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { packageManager?: string };

interface ComposerPolicy {
  advisories?: { block?: boolean };
  abandoned?: { block?: boolean; audit?: string };
  cooldown?: { period?: string };
}

interface ComposerConfig {
  policy?: ComposerPolicy;
  audit?: unknown;
  'allow-plugins'?: unknown;
}

interface ComposerJson {
  config?: ComposerConfig;
  'minimum-stability'?: string;
  'prefer-stable'?: boolean;
}

const composer = JSON.parse(readFileSync('composer.json', 'utf8')) as ComposerJson;

// Checks the floor (>= 3 days), not the exact string.
const cooldownDays = (period: string): number => {
  const match = /^(\d+)\s*(second|minute|hour|day|week)s?$/.exec(period.trim());
  if (!match) throw new Error(`unparseable cooldown period: ${period}`);
  const amountRaw = match[1];
  const unit = match[2];
  if (amountRaw === undefined || unit === undefined) throw new Error(`unparseable cooldown period: ${period}`);
  const amount = Number(amountRaw);
  const perDay: Record<string, number> = {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
  };
  const factor = perDay[unit];
  if (factor === undefined) throw new Error(`unknown cooldown unit: ${unit}`);
  return amount * factor;
};

// Reads pnpm's effective config, not just pnpm-workspace.yaml's text, so a misspelled key or a
// value pnpm ignores fails this test instead of passing silently.
const pnpmConfig = async (): Promise<Record<string, unknown>> => {
  const { stdout } = await execFileAsync('pnpm', ['config', 'list', '--json']);
  return JSON.parse(stdout) as Record<string, unknown>;
};

test('pnpm effective config carries every supply-chain setting', async () => {
  const config = await pnpmConfig();
  expect(config.minimumReleaseAge).toBeGreaterThanOrEqual(4320);
  // pnpm 11 ships a built-in exclusion for n8n/n8n-*/@n8n/*; this repo overrides it with an
  // explicit empty list, so nothing is exempt from the release-age gate.
  expect(config.minimumReleaseAgeExclude).toEqual([]);
  expect(config.trustPolicy).toBe('no-downgrade');
  expect(config.blockExoticSubdeps).toBe(true);
  expect(config.strictDepBuilds).toBe(true);
  expect(config.engineStrict).toBe(true);
  expect(config.dangerouslyAllowAllBuilds).toBe(false);
});

test('trustPolicyExclude holds exactly the owner-approved exceptions', async () => {
  const config = await pnpmConfig();
  // A new entry needs an exact name@version, a reason, this list extended, and the owner's
  // approval. See AGENTS.md's "Supply-chain hardening".
  expect(config.trustPolicyExclude).toEqual([
    '@octokit/endpoint@9.0.6',
    '@octokit/plugin-paginate-rest@9.2.2',
    '@octokit/webhooks@12.3.2',
  ]);
});

test('packageManager pins an exact pnpm 11.x version', () => {
  expect(pkg.packageManager).toMatch(/^pnpm@11\.\d+\.\d+$/);
});

test('package-lock.json does not exist', () => {
  expect(existsSync('package-lock.json')).toBe(false);
});

test('no tracked file still teaches npm commands', async () => {
  const { stdout } = await execFileAsync('git', ['ls-files']);
  const files = stdout.split('\n').filter(Boolean);
  const pattern = /\bnpm (ci|run|test|install|audit)\b|command npm|\bnpx /;
  const offenders: string[] = [];
  for (const file of files) {
    if (file === 'tests/supply-chain.test.ts') continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // binary or unreadable file; not a text hit
    }
    if (pattern.test(content)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

test('every Compose image is pinned by digest', () => {
  for (const file of ['compose.yaml', 'compose.queue.yaml']) {
    const content = readFileSync(file, 'utf8');
    const images = [...content.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => m[1]);
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
  }
});

// The merged config, so settings `n8n-worker` inherits through `extends` are checked too.
const composeConfig = async (args: string[]): Promise<Record<string, { security_opt?: string[]; cap_drop?: string[] }>> => {
  const { stdout } = await execFileAsync('docker', ['compose', ...args, 'config', '--format', 'json']);
  return (JSON.parse(stdout) as { services: Record<string, { security_opt?: string[]; cap_drop?: string[] }> }).services;
};

test('every long-running Compose service disables privilege escalation', async () => {
  // "php" is a one-shot tools container, never long-running.
  const queue = await composeConfig(['-f', 'compose.yaml', '-f', 'compose.queue.yaml']);
  for (const name of ['db', 'wordpress', 'wpcli', 'cron', 'postgres', 'n8n', 'redis', 'n8n-worker']) {
    expect(queue[name]?.security_opt, name).toContain('no-new-privileges:true');
  }
});

test('only n8n (and the worker that extends it) drops every Linux capability', async () => {
  const queue = await composeConfig(['-f', 'compose.yaml', '-f', 'compose.queue.yaml']);
  expect(queue.n8n?.cap_drop).toEqual(['ALL']);
  expect(queue['n8n-worker']?.cap_drop).toEqual(['ALL']);
  // The other images drop from root at startup, which needs capabilities (chown, setuid/setgid)
  // not yet proven safe to drop per image.
  for (const name of ['db', 'wordpress', 'wpcli', 'cron', 'postgres', 'redis']) {
    expect(queue[name]?.cap_drop, name).toBeUndefined();
  }
});

test('the PHP Dockerfile pins FROM and COPY --from by digest', () => {
  const content = readFileSync('docker/php/Dockerfile', 'utf8');
  const fromLines = [...content.matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
  const copyFromLines = [...content.matchAll(/^COPY\s+--from=(\S+)/gm)].map((m) => m[1]);
  expect(fromLines.length).toBeGreaterThan(0);
  expect(copyFromLines.length).toBeGreaterThan(0);
  for (const ref of [...fromLines, ...copyFromLines]) expect(ref).toMatch(/@sha256:[a-f0-9]{64}$/);
});

test('composer.json policy blocks insecure advisories and fails audit on abandoned packages', () => {
  expect(composer.config?.policy?.advisories?.block).toBe(true);
  expect(composer.config?.policy?.abandoned?.audit).toBe('fail');
});

test('composer.json cooldown period is at least 3 days', () => {
  const period = composer.config?.policy?.cooldown?.period;
  expect(period).toBeDefined();
  expect(cooldownDays(period as string)).toBeGreaterThanOrEqual(3);
});

test('composer.json has no deprecated config.audit key', () => {
  expect(composer.config?.audit).toBeUndefined();
});

test('composer.json allow-plugins is an object listing only installed plugins', () => {
  const allowPlugins = composer.config?.['allow-plugins'];
  expect(typeof allowPlugins).toBe('object');
  expect(allowPlugins).not.toBeNull();
  expect(Array.isArray(allowPlugins)).toBe(false);
});

test('composer.json prefers stable releases', () => {
  expect(composer['minimum-stability']).toBe('stable');
  expect(composer['prefer-stable']).toBe(true);
});

test('every `docker run` image reference in .github/workflows/*.yml is pinned by digest', () => {
  const workflowsDir = '.github/workflows';
  const files = readdirSync(workflowsDir).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));
  expect(files.length).toBeGreaterThan(0);

  const offenders: string[] = [];
  let checked = 0;
  for (const file of files) {
    const content = readFileSync(join(workflowsDir, file), 'utf8');
    // With or without an owner slash; an unparseable line still fails the digest check below.
    const images = content
      .split('\n')
      .filter((line) => /\bdocker run\b/.test(line))
      .map((line) => /\s([a-z0-9][\w./-]*:\S+)/.exec(line)?.[1] ?? `unparsed: ${line.trim()}`);
    checked += images.length;
    for (const image of images) {
      if (!/^[\w./-]+:[\w.-]+@sha256:[a-f0-9]{64}$/.test(image)) offenders.push(`${file}: ${image}`);
    }
  }
  expect(checked).toBeGreaterThan(0);
  expect(offenders).toEqual([]);
});

test('zizmor is installed from a hash-pinned requirements file with --require-hashes', () => {
  const content = readFileSync('.github/workflows/ci.yml', 'utf8');
  expect(content).toMatch(/pip install --require-hashes -r \.github\/zizmor-requirements\.txt/);

  const requirements = readFileSync('.github/zizmor-requirements.txt', 'utf8');
  expect(requirements).toMatch(/^zizmor==1\.31\.1\s*\\/m);
  const hashes = [...requirements.matchAll(/--hash=sha256:[a-f0-9]{64}/g)];
  expect(hashes.length).toBeGreaterThan(0);
});
