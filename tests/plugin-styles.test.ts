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

  it('defines the color tokens on the status card and on its invalid-link sentence, which prints alone', () => {
    const scope = /([^{}]*)\{[^{}]*--mq-color-text:/.exec(QUOTE_FORM_CSS)?.[1] ?? '';
    expect(scope).toContain('.moving-quote-status,');
    expect(scope).toContain('.moving-quote-status__invalid');
  });

  it("is mapped onto the theme's palette for every block, the status card included", () => {
    const theme = readFileSync('site/theme/style.css', 'utf8');
    const scope = /([^{}]*)\{[^{}]*--mq-color-text:/.exec(theme)?.[1] ?? '';
    for (const block of ['.moving-quote', '.moving-quote-start', '.moving-quote-routes', '.moving-quote-thanks', '.moving-quote-status', '.moving-quote-status__invalid']) expect(scope).toContain(block);
  });
});
