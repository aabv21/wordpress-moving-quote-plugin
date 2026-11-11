import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CONTROL_CHARACTER_RE, oneLine } from '../../src/nodes/lead.ts';

/** `LeadValidator::CONTROL_CHARACTER_PATTERN`'s character class, rebuilt as a JS `u` RegExp. */
function phpControlCharacterClass(): RegExp {
  const php = readFileSync('plugin/moving-quote/src/Leads/LeadValidator.php', 'utf8');
  const match = /CONTROL_CHARACTER_PATTERN = '\/\[([^\]]+)\]\+?\/u';/.exec(php);
  if (!match?.[1]) throw new Error('CONTROL_CHARACTER_PATTERN not found in LeadValidator.php');
  const body = match[1].replace(/\\x\{([0-9A-Fa-f]{1,6})\}/g, (_, hex: string) => `\\u{${hex}}`);
  // eslint-disable-next-line security/detect-non-literal-regexp -- built from the committed PHP source, not user input
  return new RegExp(`^[${body}]$`, 'u');
}

it('the PHP and TypeScript control-character sets match, code point for code point', () => {
  const php = phpControlCharacterClass();
  const mismatches: string[] = [];
  for (let cp = 0; cp <= 0xffff; cp++) {
    const char = String.fromCodePoint(cp);
    if (php.test(char) !== CONTROL_CHARACTER_RE.test(char)) mismatches.push(`U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
  }
  expect(mismatches).toEqual([]);
});

it('oneLine replaces exactly that set with a space', () => {
  for (let cp = 0; cp <= 0xffff; cp++) {
    const char = String.fromCodePoint(cp);
    expect(oneLine(`a${char}b`)).toBe(CONTROL_CHARACTER_RE.test(char) ? 'a b' : `a${char}b`);
  }
});
