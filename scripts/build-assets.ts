import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

/** The quote form, and the thank-you card's summary. Each bundle is a separate, committed file. */
export const ENTRIES = [
  { entry: 'src/frontend/quote-form.ts', outfile: 'plugin/moving-quote/assets/quote-form.js' },
  { entry: 'src/frontend/thank-you.ts', outfile: 'plugin/moving-quote/assets/thank-you.js' },
] as const;

/**
 * Returns the files that differ from what's on disk. With `check: true` nothing is written, so CI
 * can fail a stale commit without touching the working tree.
 */
export async function buildAssets(opts: { check: boolean }): Promise<string[]> {
  const stale: string[] = [];
  for (const { entry, outfile } of ENTRIES) {
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: 'iife',
      target: 'es2020',
      banner: { js: `/* Generated from ${entry} by pnpm run build:assets. Edit the source. */` },
      write: false,
    });

    const output = result.outputFiles[0];
    if (!output) throw new Error(`esbuild produced no output file for ${entry}`);
    if (safeRead(outfile) === output.text) continue;

    stale.push(outfile);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- outfile is one of this module's own ENTRIES constants
    if (!opts.check) writeFileSync(outfile, output.text);
  }
  return stale;
}

function safeRead(path: string): string | null {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path is always one of this module's own ENTRIES outfiles
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const changed = await buildAssets({ check });

  if (0 === changed.length) {
    console.log(check ? 'Assets are up to date.' : 'Assets unchanged.');
    return;
  }

  if (check) {
    console.error(`Stale assets: ${changed.join(', ')}. Run pnpm run build:assets and commit the result.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Built ${changed.join(', ')}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
