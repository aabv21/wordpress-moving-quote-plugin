import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ENTRY = 'src/frontend/quote-form.ts';
const OUTFILE = 'plugin/moving-quote/assets/quote-form.js';
const BANNER = '/* Generated from src/frontend/quote-form.ts by pnpm run build:assets. Edit the source. */';

/**
 * Returns the files that differ from what's on disk. With `check: true` nothing is written, so CI
 * can fail a stale commit without touching the working tree.
 */
export async function buildAssets(opts: { check: boolean }): Promise<string[]> {
  const result = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2020',
    banner: { js: BANNER },
    write: false,
  });

  const output = result.outputFiles[0];
  if (!output) throw new Error('esbuild produced no output file');
  const built = output.text;

  const current = safeRead(OUTFILE);
  if (current === built) return [];

  if (opts.check) return [OUTFILE];

  writeFileSync(OUTFILE, built);
  return [OUTFILE];
}

function safeRead(path: string): string | null {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is always this module's own OUTFILE constant
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const changed = await buildAssets({ check });

  if (0 === changed.length) {
    console.log(check ? 'quote-form.js is up to date.' : 'quote-form.js unchanged.');
    return;
  }

  if (check) {
    console.error(`quote-form.js is stale: ${changed.join(', ')}. Run pnpm run build:assets and commit the result.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Built ${changed.join(', ')}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
