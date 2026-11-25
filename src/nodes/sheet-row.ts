import type { Lead } from './lead.ts';
import { BUSINESS_TIMEZONE } from './locale.ts';
import { MESSAGES } from './messages.ts';

/** The `Moving leads` sheet's header row, in its exact order. */
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
  // Last, so an existing sheet only gains a column. The upsert key: unique per lead, unlike
  // `reference`, which is an 8-hex prefix of it.
  'request_uuid',
] as const;

export type SheetRow = Record<(typeof SHEET_HEADERS)[number], string | number>;

/** Always English, so the sheet stays one consistent dataset. */
export function buildSheetRow(lead: Lead): SheetRow {
  const { customer, move, estimate } = lead;
  const english = MESSAGES.en;
  // eslint-disable-next-line security/detect-object-injection -- e is Extra, one of the label table's own fixed keys, already validated by parseLead
  const extras = move.extras.map((e) => english.extras[e]).join(', ');

  return {
    received_at: DateTime.fromISO(lead.submitted_at).setZone(BUSINESS_TIMEZONE).toFormat('yyyy-LL-dd HH:mm'),
    reference: lead.reference,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    move_date: move.date,
    move_type: english.moveTypes[move.type],
    rooms: move.rooms,
    origin: move.origin,
    destination: move.destination,
    distance_km: move.distance_km,
    extras,
    estimate_cop: estimate.amount,
    estimate_low_cop: estimate.low,
    estimate_high_cop: estimate.high,
    request_uuid: lead.request_uuid,
  };
}
