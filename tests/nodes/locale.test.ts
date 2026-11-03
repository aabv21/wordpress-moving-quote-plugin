import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, normalizeLocale, parseTeamLocale, teamLocaleOrDefault } from '../../src/nodes/locale.ts';

describe('normalizeLocale', () => {
  it.each([
    ['es_CO', 'es'],
    ['es-CO', 'es'],
    ['es', 'es'],
    ['ES', 'es'],
    ['es_ES', 'es'],
    ['es-419', 'es'],
    [' es_CO ', 'es'],
    ['en_US', 'en'],
    ['en-US', 'en'],
    ['en', 'en'],
    ['EN-gb', 'en'],
  ] as const)('reads %j as %s', (value, expected) => {
    expect(normalizeLocale(value)).toBe(expected);
  });

  it.each(['', 'pt_BR', 'fr', 'e', 'espanol', 'english', '_es', '-'])('falls back to the default for %j', (value) => {
    expect(normalizeLocale(value)).toBe(DEFAULT_LOCALE);
  });

  it('falls back to the given default instead of en when one is passed', () => {
    expect(normalizeLocale('pt_BR', 'es')).toBe('es');
    expect(normalizeLocale('en_US', 'es')).toBe('en');
  });

  it('defaults to en', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
});

describe('parseTeamLocale', () => {
  it('reads en and es', () => {
    expect(parseTeamLocale({ team_locale: 'en' })).toBe('en');
    expect(parseTeamLocale({ team_locale: 'es' })).toBe('es');
  });

  it('defaults to en when the key is missing, for a config.json written before it existed', () => {
    expect(parseTeamLocale({})).toBe('en');
  });

  it.each(['es_CO', 'ES', 'fr', '', 1, null, ['es']])('rejects %j: the config takes exactly en or es', (value) => {
    expect(() => parseTeamLocale({ team_locale: value })).toThrow(/team_locale must be "en" or "es"/);
  });

  it('accepts the committed config.example.json', () => {
    const example = JSON.parse(readFileSync('config/config.example.json', 'utf8')) as { team_locale?: unknown };
    expect(example.team_locale).toBe('en');
    expect(parseTeamLocale(example)).toBe('en');
  });
});

describe('teamLocaleOrDefault', () => {
  it('reads en and es, and a missing key as en, without flagging any of them', () => {
    expect(teamLocaleOrDefault({ team_locale: 'en' })).toEqual({ locale: 'en', valid: true });
    expect(teamLocaleOrDefault({ team_locale: 'es' })).toEqual({ locale: 'es', valid: true });
    expect(teamLocaleOrDefault({})).toEqual({ locale: 'en', valid: true });
  });

  it.each(['es_CO', 'ES', 'fr', '', 1, null, ['es']])('falls back to en for %j and flags it, never throwing', (value) => {
    expect(teamLocaleOrDefault({ team_locale: value })).toEqual({ locale: 'en', valid: false });
  });
});
