export type MoveType = 'apartment' | 'house' | 'office';
export type Extra = 'packing' | 'furniture_assembly' | 'storage' | 'piano_fragile';

/** The exact lead payload contract WordPress sends to n8n. */
export interface Lead {
  request_uuid: string;
  reference: string;
  submitted_at: string;
  site_name: string;
  team_email: string;
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

/** Lowercase only: PHP's `LeadValidator::validate_submission_id()` lowercases every UUID it accepts, and `event_id` in `processed_events` is case-sensitive text. */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MOVE_TYPES = new Set<string>(['apartment', 'house', 'office']);
const EXTRAS = new Set<string>(['packing', 'furniture_assembly', 'storage', 'piano_fragile']);
const MOVE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** DATE_ATOM with a numeric offset, e.g. `2026-11-04T09:15:00-05:00` (never a bare `Z`: WordPress always converts to a named timezone before formatting). The component ranges and the offset bound are checked separately in `isValidSubmittedAt()`; a regex alone would accept `2026-99-99T99:99:99+99:99`. */
const SUBMITTED_AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2}):(\d{2})$/;
/** None of these, nor whitespace or a control character, may appear anywhere in a simple address. */
const FORBIDDEN_EMAIL_CHARS = new Set(['"', ',', ';', ':', '<', '>', '(', ')', '[', ']', '\\']);

// eslint-disable-next-line no-control-regex -- the control-character range is deliberately excluded
const EMAIL_WHITESPACE_OR_CONTROL_RE = /[\s\x00-\x1f\x7f]/;

/**
 * A simple address: exactly one `@`, non-empty local and domain parts, at least one dot in the
 * domain, and none of `" , ; < > ( ) [ ] : \` or whitespace/control characters anywhere — the
 * same rule `LeadValidator::validate_email()` applies after `FILTER_VALIDATE_EMAIL`. That
 * underlying PHP validator (and this contract's own looser, prior check) both accept a quoted
 * local part like `"a,b"@example.com`, which Gmail's own `sendTo` splits on the comma into a
 * second recipient — so both `customer.email` and `team_email` are checked against this one rule.
 * Written as plain string operations, not one nested-quantifier regex, so there's no backtracking
 * blow-up to reason about on an adversarial input.
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

/** Every key in `value` is one of `keys`, with no extra top-level field. */
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
 * `submitted_at` matches `SUBMITTED_AT_RE`'s shape, but that regex alone accepts an impossible
 * date-time like `2026-99-99T99:99:99+99:99`: every component is checked against its own real
 * range here (via Luxon, so a non-leap Feb 29 is caught too, in a fixed UTC zone — the offset
 * itself needs no timezone conversion, just its own bound below), and the UTC offset is bounded
 * to ±14:00, the widest offset any real timezone actually uses.
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
 * Code points, not UTF-16 units — matching PHP's `mb_strlen()` with UTF-8 encoding, which
 * `LeadValidator::validate_name()` counts a name by. A single basic emoji is one code point here
 * and two UTF-16 units in `.length`; a multi-code-point grapheme cluster (a ZWJ sequence, a
 * flag, a skin-tone modifier) still counts as more than one here, same as it does in `mb_strlen`
 * — this intentionally matches PHP's own code-point counting, not a full grapheme-aware count.
 */
function codePointLength(value: string): number {
  return Array.from(value).length;
}

// eslint-disable-next-line no-control-regex -- the control-character range is the whole point of this check
const CONTROL_CHARACTER_RE = /[\x00-\x1f\x7f\u0085\u2028\u2029]/;

/**
 * True if `value` contains a C0 control, DEL, NEL (U+0085), LINE SEPARATOR (U+2028), or PARAGRAPH
 * SEPARATOR (U+2029). `LeadValidator::validate_name()` normalizes this exact set to a single
 * space, so a genuine WordPress payload never carries one here — this keeps the contract exactly
 * as strict as the PHP side for the fields that land, unescaped, in a plain-text email, where any
 * of these could otherwise forge an extra line.
 */
function hasControlCharacter(value: string): boolean {
  return CONTROL_CHARACTER_RE.test(value);
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
  // PHP's LeadValidator::validate_extras() dedupes as it builds the list, so a genuine WordPress
  // payload never repeats one; reject a payload that does rather than silently accepting it.
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
 * `low` and `high` are each rounded to the nearest 1,000 COP (`Pricing\Calculator::rounded_bound`),
 * but `amount` is not — with `range_percent` 0, which Settings allows, an `amount` that isn't a
 * multiple of 1,000 then falls outside `[low, high]` even though the estimate is entirely valid.
 * Only `low <= high` is checked here; `amount` is unconstrained relative to either bound.
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

const LEAD_KEYS = ['request_uuid', 'reference', 'submitted_at', 'site_name', 'team_email', 'customer', 'move', 'estimate'] as const;

/**
 * Parses and validates the exact contract body WordPress signs and sends, matching the PHP side's
 * own field formats and ranges; never the move-date window, which is WordPress's own submit rule,
 * not re-enforced here (see the NOTE below).
 */
export function parseLead(value: unknown): Lead | null {
  if (!isRecord(value) || !hasOnlyKeys(value, LEAD_KEYS)) return null;
  const { request_uuid: requestUuid, reference, submitted_at: submittedAt, site_name: siteName, team_email: teamEmail, customer, move, estimate } = value;

  if (typeof requestUuid !== 'string' || !UUID_V4_RE.test(requestUuid)) return null;

  const expectedReference = `MQ-${requestUuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  if (typeof reference !== 'string' || reference !== expectedReference) return null;

  if (typeof submittedAt !== 'string' || !isValidSubmittedAt(submittedAt)) return null;
  // site_name is WordPress's raw, unsanitized blog title (get_bloginfo('name')), which is blank
  // once a merchant clears Settings → General → Site Title; any string, including '', is valid.
  if (typeof siteName !== 'string') return null;
  if (typeof teamEmail !== 'string' || !isSimpleEmail(teamEmail)) return null;

  const parsedCustomer = parseCustomer(customer);
  if (!parsedCustomer) return null;

  // NOTE: move.date is checked only as a valid calendar date here. The today-to-365-days window
  // is WordPress's own submit rule (Leads\LeadValidator::validate_move_date); re-enforcing it in
  // n8n would reject every retry of a lead submitted before the window's upper bound once today
  // passes that date, and reject a same-day retry made after midnight forever.
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
    customer: parsedCustomer,
    move: parsedMove,
    estimate: parsedEstimate,
  };
}
