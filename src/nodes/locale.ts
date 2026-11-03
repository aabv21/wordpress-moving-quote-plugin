/** The two languages the n8n emails are written in. */
export type Locale = 'en' | 'es';

export const LOCALES: readonly Locale[] = ['en', 'es'];

/** The language a lead falls back to when it carries no usable locale: an in-flight lead from an older plugin version, a row saved before the column existed, or a language these emails aren't written in. */
export const DEFAULT_LOCALE: Locale = 'en';

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Normalizes a WordPress or BCP 47 locale (`es_CO`, `es-CO`, `es`, `en_US`, `EN-us`, …) to one of
 * the two languages the emails are written in, by its primary language subtag alone. Anything
 * else — an empty string, `pt_BR`, a malformed value — falls back to `fallback`, so a wrong or
 * unknown locale never reads worse than the default.
 */
export function normalizeLocale(value: string, fallback: Locale = DEFAULT_LOCALE): Locale {
  const primary = value.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return isLocale(primary) ? primary : fallback;
}

/**
 * The strict check of the runtime config's `team_locale`, for validating a config file: `en` when
 * the key is absent (a `config.json` written before the key existed), the value itself when it's
 * exactly `en` or `es`, and a thrown error for anything else. `map-lead` never calls this: a lead
 * must never fail on a config typo (see `teamLocaleOrDefault()`).
 */
export function parseTeamLocale(config: { team_locale?: unknown }): Locale {
  const value = config.team_locale;
  if (value === undefined) return DEFAULT_LOCALE;
  if (typeof value === 'string' && isLocale(value)) return value;
  throw new Error(`config.team_locale must be "en" or "es", got ${JSON.stringify(value)}`);
}

/**
 * The team email's language for one lead, never throwing: the config's `team_locale` when it's
 * exactly `en` or `es` (or `en` when the key is absent), otherwise `en` with `valid: false`. The
 * config travels inside each execution's stored input, so a throw here would fail that lead's
 * customer email too, and retrying the execution would replay the same bad value.
 */
export function teamLocaleOrDefault(config: { team_locale?: unknown }): { locale: Locale; valid: boolean } {
  try {
    return { locale: parseTeamLocale(config), valid: true };
  } catch {
    return { locale: DEFAULT_LOCALE, valid: false };
  }
}
