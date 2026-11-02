import type { Extra, Lead, MoveType } from './lead.ts';

/** The `Moving leads` sheet's header row, exact order. */
export const SHEET_HEADERS = [
  'received_at',
  'reference',
  'name',
  'phone',
  'email',
  'move_date',
  'move_type',
  'rooms',
  'origin',
  'destination',
  'distance_km',
  'extras',
  'estimate_cop',
  'estimate_low_cop',
  'estimate_high_cop',
] as const;

const MOVE_TYPE_LABELS: Record<MoveType, string> = {
  apartment: 'Apartment',
  house: 'House',
  office: 'Office',
};

const EXTRA_LABELS: Record<Extra, string> = {
  packing: 'Packing',
  furniture_assembly: 'Furniture disassembly and assembly',
  storage: 'Temporary storage',
  piano_fragile: 'Piano or fragile items',
};

/** `COP 1,197,000` style, using `Intl.NumberFormat('en-US')` for the thousands grouping. */
export function formatCop(n: number): string {
  return `COP ${new Intl.NumberFormat('en-US').format(n)}`;
}

/** Escapes `& < > " '` for safe interpolation into HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/** Rooms 1-4 read as their own digit; 5 means "5 or more". */
function roomsLabel(rooms: number): string {
  return rooms >= 5 ? '5 or more' : String(rooms);
}

/** `low – high` with an en dash, e.g. `COP 1,197,000 – 1,463,000` (the high value's own `COP ` prefix dropped, matching the documented display format). */
function estimateDisplay(low: number, high: number): string {
  return `${formatCop(low)} – ${new Intl.NumberFormat('en-US').format(high)}`;
}

/** The same control-character set `LeadValidator::validate_name()` normalizes, replaced with a space. */
function oneLine(s: string): string {
  // eslint-disable-next-line no-control-regex -- the control-character range is the whole point of this check
  return s.replace(/[\x00-\x1f\x7f\u0085\u2028\u2029]/g, ' ');
}

/** "Friday, November 20, 2026", from an `America/Bogota` move date (a bare calendar date, parsed in that zone so it reads as the same day everywhere). */
function longDate(isoDate: string): string {
  return DateTime.fromISO(isoDate, { zone: 'America/Bogota' }).setLocale('en').toFormat('cccc, LLLL d, yyyy');
}

interface Config {
  google: { leads_sheet_id: string; leads_tab: string };
  alerts: { error_email: string };
}

type SheetRow = Record<(typeof SHEET_HEADERS)[number], string | number>;

interface MapLeadOutput {
  row: SheetRow;
  team: { to: string; subject: string; text: string };
  customer: { to: string; reply_to: string; subject: string; html: string };
  sender_name: string;
}

/**
 * Builds the sheet row and the two lead-notification emails (a plain-text team alert, an escaped
 * HTML customer summary) in one tested function.
 */
export function run(input: { lead: Lead; config: Config }): MapLeadOutput {
  const { lead } = input;
  const { customer, move, estimate } = lead;

  const receivedAt = DateTime.fromISO(lead.submitted_at).setZone('America/Bogota').toFormat('yyyy-LL-dd HH:mm');
  const moveTypeLabel = MOVE_TYPE_LABELS[move.type];
  // eslint-disable-next-line security/detect-object-injection -- e is Extra, one of EXTRA_LABELS' own fixed keys, already validated by parseLead
  const extrasLabel = move.extras.map((e) => EXTRA_LABELS[e]).join(', ');
  const estimateText = estimateDisplay(estimate.low, estimate.high);
  const dateText = longDate(move.date);

  const row: SheetRow = {
    received_at: receivedAt,
    reference: lead.reference,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    move_date: move.date,
    move_type: moveTypeLabel,
    rooms: move.rooms,
    origin: move.origin,
    destination: move.destination,
    distance_km: move.distance_km,
    extras: extrasLabel,
    estimate_cop: estimate.amount,
    estimate_low_cop: estimate.low,
    estimate_high_cop: estimate.high,
  };

  const teamSubject = oneLine(`New lead ${lead.reference}: ${move.origin} to ${move.destination} on ${move.date}`);
  // NOTE: plain text, with no tel:/mailto: links — WordPress's own email validator allows `?`,
  // `&`, and `=` in the local part, so a crafted lead could otherwise pre-fill a mailto reply.
  // Every value here goes through oneLine(), so a line break in any one of them can never forge
  // an extra "Phone:"/"Email:"/etc. line in this plain-text email.
  const teamText = [
    `Name: ${oneLine(customer.name)}`,
    `Phone: ${oneLine(customer.phone)}`,
    `Email: ${oneLine(customer.email)}`,
    `Move date: ${dateText}`,
    `Route: ${oneLine(move.origin)} to ${oneLine(move.destination)} (${oneLine(String(move.distance_km))} km)`,
    `Type: ${moveTypeLabel}, ${oneLine(roomsLabel(move.rooms))} room(s)`,
    `Extras: ${extrasLabel === '' ? 'None' : extrasLabel}`,
    `Estimate: ${estimateText}`,
    `Reference: ${oneLine(lead.reference)}`,
  ].join('\n');

  const customerSubject = oneLine(`Your moving estimate from ${lead.site_name}`);
  const customerHtml = [
    `<p>Hi ${escapeHtml(customer.name)},</p>`,
    `<p>Your moving estimate: <strong>${estimateText}</strong></p>`,
    `<p>${escapeHtml(move.origin)} to ${escapeHtml(move.destination)} on ${dateText}</p>`,
    '<p>This is an estimate. We confirm the final price after a visit or video call.</p>',
    '<p>A member of our team will call you to schedule a short visit or video call and confirm the final price.</p>',
    `<p>Reference: ${escapeHtml(lead.reference)}</p>`,
  ].join('\n');

  return {
    row,
    team: { to: lead.team_email, subject: teamSubject, text: teamText },
    customer: { to: customer.email, reply_to: lead.team_email, subject: customerSubject, html: customerHtml },
    sender_name: oneLine(lead.site_name),
  };
}
