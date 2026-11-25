import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const QUOTE_FORM_CSS = readFileSync('plugin/moving-quote/assets/quote-form.css', 'utf8');

/** Each `--mq-color-*: <value>;` declared on the plugin's block roots. */
function colorTokens(css: string): Map<string, string> {
  return new Map([...css.matchAll(/(--mq-color-[a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name ?? '', (value ?? '').trim()]));
}

describe("the plugin's stylesheet", () => {
  it("never reads a theme's palette or font presets, so another theme (a dark variation included) can't recolor the form", () => {
    // A theme that wants the form in its colors sets the --mq-* tokens itself, as the Chivabox theme does.
    expect(QUOTE_FORM_CSS).not.toMatch(/--wp--preset--/);
  });

  it('gives every color token a literal default', () => {
    const tokens = colorTokens(QUOTE_FORM_CSS);
    expect(tokens.size).toBeGreaterThan(10);
    for (const [name, value] of tokens) expect(value, name).toMatch(/^#[0-9a-f]{3,8}$/i);
  });
});
