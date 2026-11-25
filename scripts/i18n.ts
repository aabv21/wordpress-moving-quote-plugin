import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutCreationDate } from './lib/gettext.ts';

export interface TextDomain {
  domain: string;
  /** Where the committed `.pot`, `.po`, `.mo` and `.l10n.php` live, relative to the repo root. */
  languagesDir: string;
  /** The same folder's parent as `compose.yaml` mounts it, read-only, in `wpcli`. */
  containerDir: string;
  potFile: string;
  /** A plugin's catalogs are `<domain>-<locale>.po`; a theme's are `<locale>.po`. */
  poPrefix: string;
  /** Folders `make-pot` skips. */
  exclude: string;
}

export const TEXT_DOMAINS: readonly TextDomain[] = [
  {
    domain: 'moving-quote',
    languagesDir: 'plugin/moving-quote/languages',
    containerDir: '/var/www/html/wp-content/plugins/moving-quote',
    potFile: 'moving-quote.pot',
    poPrefix: 'moving-quote-',
    exclude: 'vendor,assets,languages',
  },
  {
    domain: 'chivabox',
    languagesDir: 'site/theme/languages',
    containerDir: '/var/www/html/wp-content/themes/chivabox',
    potFile: 'chivabox.pot',
    poPrefix: '',
    exclude: 'assets,languages',
  },
];

/** Scratch output inside the container, since both mounts are read-only. */
const CONTAINER_OUT_ROOT = '/tmp/chivabox-i18n';

/**
 * Fixed, so the `.pot` depends only on the sources: make-pot would otherwise point
 * `Report-Msgid-Bugs-To` at a wordpress.org forum and stamp the current year.
 */
const POT_HEADERS = JSON.stringify({ 'Report-Msgid-Bugs-To': 'https://github.com/aabv21/wordpress-moving-quote-plugin/issues' });
const POT_FILE_COMMENT = 'Copyright (C) Andrés Buelvas. This file is distributed under the MIT license.';

/**
 * PHP only: the bundled JavaScript has no gettext calls. `--no-location` drops `#: file:line`, so
 * the drift check fails on a changed string, not a shifted line.
 */
function generateScript(text: TextDomain, outDir: string): string {
  return [
    `rm -rf ${outDir}`,
    `mkdir -p ${outDir}`,
    `wp i18n make-pot ${text.containerDir} ${outDir}/${text.potFile} --slug=${text.domain} --domain=${text.domain} --skip-js --skip-block-json --skip-theme-json --exclude=${text.exclude} --no-location --headers='${POT_HEADERS}' --file-comment='${POT_FILE_COMMENT}' --quiet`,
    `if ls ${text.containerDir}/languages/*.po >/dev/null 2>&1; then wp i18n make-mo ${text.containerDir}/languages ${outDir} --quiet && wp i18n make-php ${text.containerDir}/languages ${outDir} --quiet; fi`,
  ].join(' && ');
}

function wpcli(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('docker', ['compose', 'exec', '-T', 'wpcli', ...args], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr.toString()}`));
      else resolve(stdout);
    });
  });
}

export async function generate(text: TextDomain): Promise<Map<string, Buffer>> {
  const outDir = `${CONTAINER_OUT_ROOT}/${text.domain}`;
  await wpcli(['sh', '-c', generateScript(text, outDir)]);
  const names = (await wpcli(['ls', outDir])).toString('utf8').split('\n').filter(Boolean);
  const files = new Map<string, Buffer>();
  for (const name of names) files.set(name, await wpcli(['cat', `${outDir}/${name}`]));
  return files;
}

/** Byte for byte, except a `.pot` ignores its `POT-Creation-Date` line. */
export function sameContent(name: string, generated: Buffer, committed: Buffer | null): boolean {
  if (committed === null) return false;
  if (name.endsWith('.pot')) return withoutCreationDate(generated.toString('utf8')) === withoutCreationDate(committed.toString('utf8'));
  return generated.equals(committed);
}

function readCommitted(dir: string, name: string): Buffer | null {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- name comes from the container's own fixed output folder listing, joined under a TEXT_DOMAINS folder
    return readFileSync(join(dir, name));
  } catch {
    return null;
  }
}

/**
 * Returns the names that differ from what's committed. A `.mo` or `.l10n.php` with no `.po` left
 * counts as stale, and is removed when not checking.
 */
export async function syncTranslations(opts: { check: boolean }): Promise<string[]> {
  const changed: string[] = [];

  for (const text of TEXT_DOMAINS) {
    const dir = text.languagesDir;
    const generated = await generate(text);

    for (const [name, content] of generated) {
      if (sameContent(name, content, readCommitted(dir, name))) continue;
      changed.push(join(dir, name));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- name comes from the container's own fixed output folder listing, joined under a TEXT_DOMAINS folder
      if (!opts.check) writeFileSync(join(dir, name), content);
    }

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- dir is a TEXT_DOMAINS constant
    const orphans = readdirSync(dir).filter((name) => /\.(mo|l10n\.php)$/.test(name) && !generated.has(name));
    if (!opts.check) for (const name of orphans) rmSync(join(dir, name));
    changed.push(...orphans.map((name) => join(dir, name)));
  }
  return changed;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const changed = await syncTranslations({ check });

  if (changed.length === 0) {
    console.log(check ? 'Translation files are up to date.' : 'Translation files unchanged.');
    return;
  }
  if (check) {
    console.error(`Stale translation files: ${changed.join(', ')}. Run pnpm run i18n with the stack up and commit the result.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Updated ${changed.join(', ')}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
