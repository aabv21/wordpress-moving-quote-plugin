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

// Parses a Composer cooldown duration string ("3 days") into days, so the test checks the
// semantic floor (>= 3 days) rather than the exact string.
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
  // Any future entry here needs the same shape (an exact name@version, never a bare name), a
  // reason, this test extended to list it, and the owner's approval. See AGENTS.md's
  // "Supply-chain hardening" section.
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

test('every long-running Compose service sets no-new-privileges', () => {
  // "php" is excluded: it's a one-shot `docker compose run` tools container (profiles: [tools]),
  // never a long-running service. "n8n-worker" (compose.queue.yaml) inherits the base n8n
  // service's security_opt through `extends`, so it has no security_opt block of its own to find
  // here — it's covered by the n8n service's own occurrence instead.
  const longRunningServices = ['db', 'wordpress', 'wpcli', 'cron', 'postgres', 'n8n', 'redis'];
  const composeYaml = readFileSync('compose.yaml', 'utf8');
  const queueYaml = readFileSync('compose.queue.yaml', 'utf8');

  for (const service of longRunningServices) {
    const inComposeYaml = composeYaml.includes(`\n  ${service}:\n`);
    const inQueueYaml = queueYaml.includes(`\n  ${service}:\n`);
    expect(inComposeYaml || inQueueYaml, `expected to find service "${service}" in compose.yaml or compose.queue.yaml`).toBe(true);
  }

  const noNewPrivilegesCount = (content: string): number => [...content.matchAll(/no-new-privileges:true/g)].length;
  // db, wordpress, wpcli, cron, postgres, n8n in compose.yaml, plus redis in compose.queue.yaml.
  expect(noNewPrivilegesCount(composeYaml)).toBe(6);
  expect(noNewPrivilegesCount(queueYaml)).toBe(1);
});

test('the n8n service drops every Linux capability; every other service keeps its own', () => {
  const composeYaml = readFileSync('compose.yaml', 'utf8');
  const n8nBlockMatch = /\n {2}n8n:\n([\s\S]*?)\n {2}\S/.exec(`${composeYaml}\n  \0`);
  expect(n8nBlockMatch).not.toBeNull();
  expect(n8nBlockMatch?.[1]).toMatch(/cap_drop:\s*\[\s*ALL\s*\]/);

  // Only n8n carries cap_drop: Postgres, MySQL, WordPress/Apache, and Redis each switch users
  // internally at startup (dropping from root to their own service account), which needs a
  // capability (e.g. chown, setuid/setgid) this repo hasn't proven safe to drop per-image yet.
  const capDropCount = [...composeYaml.matchAll(/cap_drop:/g)].length;
  expect(capDropCount).toBe(1);
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
    const images = [...content.matchAll(/docker run\b[^\n]*?\s(\S+\/\S+:\S+)/g)].map((m) => m[1]).filter((image): image is string => image !== undefined);
    checked += images.length;
    for (const image of images) {
      if (!/@sha256:[a-f0-9]{64}$/.test(image)) offenders.push(`${file}: ${image}`);
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
