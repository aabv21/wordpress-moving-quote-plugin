import { DEFAULT_LOCALE, normalizeLocale, type Locale } from './locale.ts';

export type MoveType = 'apartment' | 'house' | 'office';
export type Extra = 'packing' | 'furniture_assembly' | 'storage' | 'piano_fragile';

/**
 * The parsed lead contract. `locale` arrives as a WordPress locale (`es_CO`) and is stored
 * normalized to the email language it selects.
 */
export interface Lead {
  request_uuid: string;
  reference: string;
  submitted_at: string;
  site_name: string;
  team_email: string;
  locale: Locale;
  customer: {
    name: string;
    phone: string;
    email: string;
  };
  move: {
    type: MoveType;
    rooms: number;
    origin: string;
    destination: string;
    distance_km: number;
    date: string;
    extras: Extra[];
  };
  estimate: {
    currency: 'COP';
    amount: number;
    low: number;
    high: number;
  };
}

/** Lowercase only: PHP lowercases every UUID, and `processed_events.event_id` is case-sensitive. */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MOVE_TYPES = new Set<string>(['apartment', 'house', 'office']);
const EXTRAS = new Set<string>(['packing', 'furniture_assembly', 'storage', 'piano_fragile']);
const MOVE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** DATE_ATOM with a numeric offset, never `Z` (WordPress formats in a named zone). Ranges are checked in `isValidSubmittedAt()`. */
const SUBMITTED_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;
const FORBIDDEN_EMAIL_CHARS = new Set(['"', ',', ';', ':', '<', '>', '(', ')', '[', ']', '\\']);

// eslint-disable-next-line no-control-regex -- the control-character range is deliberately excluded
const EMAIL_WHITESPACE_OR_CONTROL_RE = /[\s\x00-\x1f\x7f]/;

/**
 * One `@`, non-empty parts, a dot in the domain, and none of `" , ; < > ( ) [ ] : \`, whitespace,
 * or controls: the rule `LeadValidator::is_simple_email()` applies. A quoted local part like
 * `"a,b"@example.com` would make Gmail's `sendTo` add a second recipient. Plain string operations,
 * not a nested-quantifier regex, so there's no backtracking blow-up.
 */
function isSimpleEmail(value: string): boolean {
  if (EMAIL_WHITESPACE_OR_CONTROL_RE.test(value)) return false;
  for (const char of value) {
    if (FORBIDDEN_EMAIL_CHARS.has(char)) return false;
  }

  const atIndex = value.indexOf('@');
  if (atIndex <= 0 || atIndex !== value.lastIndexOf('@')) return false;

  const domain = value.slice(atIndex + 1);
  return domain.length > 0 && domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isValidCalendarDate(value: string): boolean {
  const match = MOVE_DATE_RE.exec(value);
  if (!match) return false;
  const [, yearStr, monthStr, dayStr] = match as unknown as [string, string, string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = DateTime.fromObject({ year, month, day });
  return date.isValid && date.year === year && date.month === month && date.day === day;
}

/**
 * The regex alone accepts `2026-99-99T99:99:99+99:99`. Luxon checks each component (a non-leap
 * Feb 29 included), and the offset is bounded to ±14:00, the widest real one.
 */
function isValidSubmittedAt(value: string): boolean {
  const match = SUBMITTED_AT_RE.exec(value);
  if (!match) return false;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr, , offsetHourStr, offsetMinuteStr] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const offsetHour = Number(offsetHourStr);
  const offsetMinute = Number(offsetMinuteStr);
  if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute > 0)) return false;

  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  const date = DateTime.fromObject({ year, month, day, hour, minute, second }, { zone: 'utc' });
  return date.isValid && date.year === year && date.month === month && date.day === day && date.hour === hour && date.minute === minute && date.second === second;
}

/**
 * Code points, not UTF-16 units or graphemes, to match PHP's `mb_strlen()` in
 * `LeadValidator::validate_name()`.
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * C0 controls, DEL, NEL, U+2028, U+2029: the set `LeadValidator::CONTROL_CHARACTER_PATTERN`
 * normalizes. Any of them could forge an extra line in a plain-text email.
 */
// eslint-disable-next-line no-control-regex -- the control-character range is the whole point of this check
export const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f\u0085\u2028\u2029]/;

function hasControlCharacter(value: string): boolean {
  return CONTROL_CHARACTER_RE.test(value);
}

/** Replaces every `CONTROL_CHARACTER_RE` character with a space, so a value stays on one line. */
export function oneLine(s: string): string {
  return Array.from(s, (char) => (CONTROL_CHARACTER_RE.test(char) ? ' ' : char)).join('');
}

function parseCustomer(value: unknown): Lead['customer'] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name', 'phone', 'email'])) return null;
  const { name, phone, email } = value;

  if (typeof name !== 'string' || hasControlCharacter(name)) return null;
  const nameLength = codePointLength(name);
  if (nameLength < 2 || nameLength > 100) return null;
  if (typeof phone !== 'string' || !/^\d{10,15}$/.test(phone)) return null;
  if (typeof email !== 'string' || email.length > 254 || !isSimpleEmail(email)) return null;

  return { name, phone, email };
}

function parseMove(value: unknown): Lead['move'] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['type', 'rooms', 'origin', 'destination', 'distance_km', 'date', 'extras'])) return null;
  const { type, rooms, origin, destination, distance_km: distanceKm, date, extras } = value;

  if (typeof type !== 'string' || !MOVE_TYPES.has(type)) return null;
  if (typeof rooms !== 'number' || !Number.isInteger(rooms) || rooms < 1 || rooms > 5) return null;
  if (typeof origin !== 'string' || origin.length === 0 || hasControlCharacter(origin)) return null;
  if (typeof destination !== 'string' || destination.length === 0 || hasControlCharacter(destination)) return null;
  if (typeof distanceKm !== 'number' || !Number.isInteger(distanceKm) || distanceKm < 0) return null;
  if (typeof date !== 'string' || !isValidCalendarDate(date)) return null;
  if (!Array.isArray(extras) || !extras.every((extra): extra is string => typeof extra === 'string' && EXTRAS.has(extra))) return null;
  // PHP dedupes extras, so a repeat means the payload didn't come from WordPress.
  if (new Set(extras).size !== extras.length) return null;

  return {
    type: type as MoveType,
    rooms,
    origin,
    destination,
    distance_km: distanceKm,
    date,
    extras: extras as Extra[],
  };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Only `low <= high`: the bounds are rounded to 1,000 COP but `amount` isn't, so with
 * `range_percent` 0 a valid `amount` can fall outside `[low, high]`.
 */
function parseEstimate(value: unknown): Lead['estimate'] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['currency', 'amount', 'low', 'high'])) return null;
  const { currency, amount, low, high } = value;

  if (currency !== 'COP') return null;
  if (!isNonNegativeSafeInteger(amount)) return null;
  if (!isNonNegativeSafeInteger(low)) return null;
  if (!isNonNegativeSafeInteger(high)) return null;
  if (low > high) return null;

  return { currency, amount, low, high };
}

const LEAD_KEYS = ['request_uuid', 'reference', 'submitted_at', 'site_name', 'team_email', 'locale', 'customer', 'move', 'estimate'] as const;

/**
 * Optional: a lead from an older plugin version can still be in the retry queue. Missing, empty,
 * or unknown reads as the default language; a non-string is a contract violation (null).
 */
function parseLocale(value: unknown): Locale | null {
  if (value === undefined) return DEFAULT_LOCALE;
  if (typeof value !== 'string') return null;
  return normalizeLocale(value);
}

export function parseLead(value: unknown): Lead | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LEAD_KEYS)) return null;
  const { request_uuid: requestUuid, reference, submitted_at: submittedAt, site_name: siteName, team_email: teamEmail, locale, customer, move, estimate } = value;

  if (typeof requestUuid !== 'string' || !UUID_V4_RE.test(requestUuid)) return null;

  const expectedReference = `MQ-${requestUuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  if (typeof reference !== 'string' || reference !== expectedReference) return null;

  if (typeof submittedAt !== 'string' || !isValidSubmittedAt(submittedAt)) return null;
  // The raw blog title, blank when the Site Title is cleared, so '' is valid.
  if (typeof siteName !== 'string') return null;
  if (typeof teamEmail !== 'string' || !isSimpleEmail(teamEmail)) return null;

  const parsedLocale = parseLocale(locale);
  if (!parsedLocale) return null;

  const parsedCustomer = parseCustomer(customer);
  if (!parsedCustomer) return null;

  // Only a valid calendar date: the today-to-365-days window is WordPress's submit rule, and
  // re-checking it here would reject a legitimate retry once the window has moved.
  const parsedMove = parseMove(move);
  if (!parsedMove) return null;

  const parsedEstimate = parseEstimate(estimate);
  if (!parsedEstimate) return null;

  return {
    request_uuid: requestUuid,
    reference,
    submitted_at: submittedAt,
    site_name: siteName,
    team_email: teamEmail,
    locale: parsedLocale,
    customer: parsedCustomer,
    move: parsedMove,
    estimate: parsedEstimate,
  };
}
