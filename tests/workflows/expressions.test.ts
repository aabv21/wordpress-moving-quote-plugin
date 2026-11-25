import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { listJsonFiles } from '../../scripts/lib/list-json-files.ts';

/** The `{{ … }}` segments of an n8n expression string, or an error naming what is unterminated. */
function expressionSegments(value: string): { segments: string[]; error: string | null } {
  const segments: string[] = [];
  let at = value.indexOf('{{');
  while (at !== -1) {
    let depth = 0;
    let quote = '';
    let i = at + 2;
    let end = -1;
    for (; i < value.length; i++) {
      const char = value.charAt(i);
      if (quote !== '') {
        if (char === '\\') i++;
        else if (char === quote) quote = '';
        continue;
      }
      if (char === "'" || char === '"' || char === '`') quote = char;
      else if (char === '{') depth++;
      else if (char === '}' && depth > 0) depth--;
      else if (char === '}' && value.charAt(i + 1) === '}') {
        end = i;
        break;
      }
    }
    if (end === -1) return { segments, error: quote === '' ? 'a {{ is never closed' : `a ${quote} string is never closed` };
    segments.push(value.slice(at + 2, end));
    at = value.indexOf('{{', end + 2);
  }
  return { segments, error: null };
}

/** `null` when the segment is valid JavaScript as an expression. */
function compileError(segment: string): string | null {
  try {
    new Script(`(${segment}\n)`);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function expressionStrings(value: unknown, path: string, found: { path: string; text: string }[] = []): { path: string; text: string }[] {
  if (typeof value === 'string' && value.startsWith('=') && value.includes('{{')) found.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((item, i) => expressionStrings(item, `${path}[${String(i)}]`, found));
  else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) expressionStrings(item, `${path}.${key}`, found);
  return found;
}

describe('every n8n expression compiles', () => {
  for (const file of listJsonFiles('workflows')) {
    it(basename(file), () => {
      const workflow = JSON.parse(readFileSync(file, 'utf8')) as { nodes: { name: string; parameters: unknown }[] };
      const problems: string[] = [];
      let checked = 0;
      for (const node of workflow.nodes) {
        for (const { path, text } of expressionStrings(node.parameters, node.name)) {
          const { segments, error } = expressionSegments(text);
          if (error !== null) problems.push(`${path}: ${error}`);
          for (const segment of segments) {
            checked++;
            const failure = compileError(segment);
            if (failure !== null) problems.push(`${path}: ${failure}`);
          }
        }
      }
      expect(problems).toEqual([]);
      expect(checked, 'a workflow with no expression to check would pass for the wrong reason').toBeGreaterThan(0);
    });
  }

  it('rejects a stray quote, the break an unescaped apostrophe causes', () => {
    const bad = expressionSegments("={{ 'it's' }}");
    expect(bad.error !== null || bad.segments.some((segment) => compileError(segment) !== null)).toBe(true);
    expect(compileError("'it's'")).not.toBeNull();
    expect(compileError("{ config: $('Parse config').first().json.config, rows: $json.rows ?? [] }")).toBeNull();
  });
});
