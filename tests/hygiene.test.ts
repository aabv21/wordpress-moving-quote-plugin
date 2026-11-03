import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

// Plan, task, and ruling references mean nothing to a reader of this repo: each comment, test, doc,
// and sticky note states its own reason instead. Finding-style IDs (e.g. "C1", "I4") are deliberately
// not matched here: they collide with legitimate text this repo actually has (C0 control-character
// references, among others), so that check isn't included.
const REFERENCE = /Ruling P\d|Task \d|\btask-\d{2}\b|\bthe brief\b|global constraints|\bowner session\b|\bintegration pass\b/;

// Lockfiles and generated files carry no authored prose of their own, so a match inside one would
// only ever be an accident of their content, never something worth fixing by hand.
const EXCLUDED_FILES = new Set(['pnpm-lock.yaml', 'tests/hygiene.test.ts', 'plugin/moving-quote/assets/quote-form.js']);
const EXCLUDED_PREFIXES = ['plugin/moving-quote/vendor/'];

test('no tracked file points at a plan task, a brief, or a ruling instead of stating its reason', async () => {
  const { stdout } = await promisify(execFile)('git', ['ls-files', '--cached', '--others', '--exclude-standard']);
  const offenders: string[] = [];
  for (const file of stdout.split('\n').filter(Boolean)) {
    if (EXCLUDED_FILES.has(file) || EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue; // a file deleted in the working tree but still in the index, or binary
    }
    content.split('\n').forEach((line, index) => {
      if (REFERENCE.test(line)) offenders.push(`${file}:${String(index + 1)}`);
    });
  }
  expect(offenders).toEqual([]);
});
