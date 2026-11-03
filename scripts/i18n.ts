import { execFile } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutCreationDate } from './lib/gettext.ts';

/** The plugin's translation folder on the host (`Domain Path: /languages` in the plugin header). */
export const LANGUAGES_DIR = 'plugin/moving-quote/languages';
export const POT_FILE = 'moving-quote.pot';

/** The same folder as the `wpcli` container sees it: `compose.yaml` bind-mounts the plugin there read-only. */
const CONTAINER_PLUGIN_DIR = '/var/www/html/wp-content/plugins/moving-quote';
/** Scratch output inside the container, since the plugin mount is read-only. */
const CONTAINER_OUT_DIR = '/tmp/moving-quote-i18n';

/**
 * Fixed headers, so the regenerated `.pot` depends only on the plugin's own sources: make-pot
 * would otherwise point `Report-Msgid-Bugs-To` at a wordpress.org support forum this plugin
 * doesn't have, and stamp the current year into the file comment.
 */
const POT_HEADERS = JSON.stringify({ 'Report-Msgid-Bugs-To': 'https://github.com/aabv21/wordpress-moving-quote-plugin/issues' });
const POT_FILE_COMMENT = 'Copyright (C) Andrés Buelvas. This file is distributed under the MIT license.';

/**
 * One `sh -c` script, every path in it a constant of this module: extract the `.pot` from the
 * plugin's PHP (the bundled JavaScript has no gettext calls; its strings arrive translated through
 * `data-config`), then compile every `.po` already in `languages/` to `.mo` and `.l10n.php`.
 * `--no-location` leaves out `#: file:line` references, so the drift check fails when a string is
 * added, changed, or removed, not every time an edit shifts a line; translator comments and
 * `msgctxt` still carry each message's context.
 */
const GENERATE_SCRIPT = [
  `rm -rf ${CONTAINER_OUT_DIR}`,
  `mkdir -p ${CONTAINER_OUT_DIR}`,
  `wp i18n make-pot ${CONTAINER_PLUGIN_DIR} ${CONTAINER_OUT_DIR}/${POT_FILE} --slug=moving-quote --domain=moving-quote --skip-js --skip-block-json --skip-theme-json --exclude=vendor,assets,languages --no-location --headers='${POT_HEADERS}' --file-comment='${POT_FILE_COMMENT}' --quiet`,
  `if ls ${CONTAINER_PLUGIN_DIR}/languages/*.po >/dev/null 2>&1; then wp i18n make-mo ${CONTAINER_PLUGIN_DIR}/languages ${CONTAINER_OUT_DIR} --quiet && wp i18n make-php ${CONTAINER_PLUGIN_DIR}/languages ${CONTAINER_OUT_DIR} --quiet; fi`,
].join(' && ');

/** Runs `docker compose exec -T wpcli <args>` and resolves with its raw stdout bytes. */
function wpcli(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('docker', ['compose', 'exec', '-T', 'wpcli', ...args], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${err.message}\n${stderr.toString()}`));
      else resolve(stdout);
    });
  });
}

/** Generates the `.pot`, `.mo`, and `.l10n.php` files in the `wpcli` container and reads each one back, keyed by file name. */
export async function generate(): Promise<Map<string, Buffer>> {
  await wpcli(['sh', '-c', GENERATE_SCRIPT]);
  const names = (await wpcli(['ls', CONTAINER_OUT_DIR])).toString('utf8').split('\n').filter(Boolean);
  const files = new Map<string, Buffer>();
  for (const name of names) files.set(name, await wpcli(['cat', `${CONTAINER_OUT_DIR}/${name}`]));
  return files;
}

/**
 * Whether a freshly generated file matches the committed one: byte for byte, except a `.pot`
 * compares without its `POT-Creation-Date` line, which make-pot stamps with the current time.
 */
export function sameContent(name: string, generated: Buffer, committed: Buffer | null): boolean {
  if (committed === null) return false;
  if (name.endsWith('.pot')) return withoutCreationDate(generated.toString('utf8')) === withoutCreationDate(committed.toString('utf8'));
  return generated.equals(committed);
}

function readCommitted(name: string): Buffer | null {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- name comes from the container's own fixed output folder listing, joined under LANGUAGES_DIR
    return readFileSync(join(LANGUAGES_DIR, name));
  } catch {
    return null;
  }
}

/**
 * Regenerates every translation file and returns the names that differ from what's committed.
 * With `check: true` nothing is written. A committed `.mo` or `.l10n.php` with no `.po` left to
 * build it from counts as stale too, and is removed when not checking.
 */
export async function syncTranslations(opts: { check: boolean }): Promise<string[]> {
  const generated = await generate();
  const changed: string[] = [];

  for (const [name, content] of generated) {
    if (sameContent(name, content, readCommitted(name))) continue;
    changed.push(name);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- name comes from the container's own fixed output folder listing, joined under LANGUAGES_DIR
    if (!opts.check) writeFileSync(join(LANGUAGES_DIR, name), content);
  }

  const orphans = readdirSync(LANGUAGES_DIR).filter((name) => /\.(mo|l10n\.php)$/.test(name) && !generated.has(name));
  if (!opts.check) for (const name of orphans) rmSync(join(LANGUAGES_DIR, name));
  return [...changed, ...orphans];
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
