export type Locale = 'en' | 'es';

export const LOCALES: readonly Locale[] = ['en', 'es'];

export const DEFAULT_LOCALE: Locale = 'en';

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * By primary subtag alone (`es_CO`, `es-CO`, `EN-us`, …). Anything else, `''` and `pt_BR`
 * included, gets `fallback`.
 */
export function normalizeLocale(value: string, fallback: Locale = DEFAULT_LOCALE): Locale {
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return isLocale(primary) ? primary : fallback;
}

/**
 * Strict, for checking a config file: `en` when absent, throws for anything but `en`/`es`.
 * `map-lead` uses `teamLocaleOrDefault()` instead, so a config typo never fails a lead.
 */
export function parseTeamLocale(config: { team_locale?: unknown }): Locale {
  const value = config.team_locale;
  if (value === undefined) return DEFAULT_LOCALE;
  if (typeof value === 'string' && isLocale(value)) return value;
  throw new Error(`config.team_locale must be "en" or "es", got ${JSON.stringify(value)}`);
}

/**
 * Never throws: an invalid value gives `en` with `valid: false`. Config travels in each
 * execution's stored input, so a throw would fail the customer email and every retry too.
 */
export function teamLocaleOrDefault(config: { team_locale?: unknown }): { locale: Locale; valid: boolean } {
  try {
    return { locale: parseTeamLocale(config), valid: true };
  } catch {
    return { locale: DEFAULT_LOCALE, valid: false };
  }
}
