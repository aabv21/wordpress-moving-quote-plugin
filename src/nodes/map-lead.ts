import { oneLine, type Extra, type Lead, type MoveType } from './lead.ts';
import { normalizeLocale, TEAM_LOCALE_NOTE, teamLocaleOrDefault, type Locale } from './locale.ts';

export { TEAM_LOCALE_NOTE };

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

/** Always English, so the sheet stays one consistent dataset. */
const SHEET_MOVE_TYPE_LABELS: Record<MoveType, string> = {
  apartment: 'Apartment',
  house: 'House',
  office: 'Office',
};

const SHEET_EXTRA_LABELS: Record<Extra, string> = {
  packing: 'Packing',
  furniture_assembly: 'Furniture disassembly and assembly',
  storage: 'Temporary storage',
  piano_fragile: 'Piano or fragile items',
};

/**
 * Callers pass values already escaped (HTML) or `oneLine()`'d (text); no entry escapes on its own.
 */
interface Messages {
  numberLocale: string;
  dateLocale: string;
  dateFormat: string;
  moveTypes: Record<MoveType, string>;
  extras: Record<Extra, string>;
  noExtras: string;
  rooms: (rooms: number) => string;
  teamSubject: (reference: string, origin: string, destination: string, date: string) => string;
  teamLabels: { name: string; phone: string; email: string; moveDate: string; route: string; type: string; extras: string; estimate: string; reference: string };
  route: (origin: string, destination: string, km: string) => string;
  customerSubject: (siteName: string) => string;
  greeting: (name: string) => string;
  estimateLine: (estimate: string) => string;
  routeLine: (origin: string, destination: string, date: string) => string;
  disclaimer: string;
  nextStep: string;
  referenceLine: (reference: string) => string;
}

export const MESSAGES: Record<Locale, Messages> = {
  en: {
    numberLocale: 'en-US',
    dateLocale: 'en',
    dateFormat: 'cccc, LLLL d, yyyy',
    moveTypes: SHEET_MOVE_TYPE_LABELS,
    extras: SHEET_EXTRA_LABELS,
    noExtras: 'None',
    rooms: (rooms) => (rooms >= 5 ? '5 or more rooms' : rooms === 1 ? '1 room' : `${String(rooms)} rooms`),
    teamSubject: (reference, origin, destination, date) => `New lead ${reference}: ${origin} to ${destination} on ${date}`,
    teamLabels: { name: 'Name', phone: 'Phone', email: 'Email', moveDate: 'Move date', route: 'Route', type: 'Type', extras: 'Extras', estimate: 'Estimate', reference: 'Reference' },
    route: (origin, destination, km) => `${origin} to ${destination} (${km} km)`,
    customerSubject: (siteName) => `Your moving estimate from ${siteName}`,
    greeting: (name) => `Hi ${name},`,
    estimateLine: (estimate) => `Your moving estimate: <strong>${estimate}</strong>`,
    routeLine: (origin, destination, date) => `${origin} to ${destination} on ${date}`,
    disclaimer: 'This is an estimate. We confirm the final price after a visit or video call.',
    nextStep: 'A member of our team will call you to schedule a short visit or video call and confirm the final price.',
    referenceLine: (reference) => `Reference: ${reference}`,
  },
  es: {
    numberLocale: 'es-CO',
    dateLocale: 'es',
    dateFormat: "cccc d 'de' LLLL 'de' yyyy",
    moveTypes: { apartment: 'Apartamento', house: 'Casa', office: 'Oficina' },
    extras: {
      packing: 'Embalaje',
      furniture_assembly: 'Desarme y armado de muebles',
      storage: 'Almacenamiento temporal',
      piano_fragile: 'Piano u objetos frágiles',
    },
    noExtras: 'Ninguno',
    rooms: (rooms) => (rooms >= 5 ? '5 o más habitaciones' : rooms === 1 ? '1 habitación' : `${String(rooms)} habitaciones`),
    teamSubject: (reference, origin, destination, date) => `Nueva solicitud ${reference}: ${origin} a ${destination} el ${date}`,
    teamLabels: {
      name: 'Nombre',
      phone: 'Teléfono',
      email: 'Correo',
      moveDate: 'Fecha de la mudanza',
      route: 'Ruta',
      type: 'Tipo',
      extras: 'Servicios adicionales',
      estimate: 'Estimado',
      reference: 'Referencia',
    },
    route: (origin, destination, km) => `${origin} a ${destination} (${km} km)`,
    customerSubject: (siteName) => `Su cotización de mudanza de ${siteName}`,
    greeting: (name) => `Hola, ${name}:`,
    estimateLine: (estimate) => `Valor estimado de su mudanza: <strong>${estimate}</strong>`,
    routeLine: (origin, destination, date) => `De ${origin} a ${destination}, el ${date}`,
    disclaimer: 'Este valor es un estimado. Confirmamos el precio final después de una visita o una videollamada.',
    nextStep: 'Una persona de nuestro equipo se comunicará con usted para programar una visita corta o una videollamada y confirmar el precio final.',
    referenceLine: (reference) => `Referencia: ${reference}`,
  },
};

function formatNumber(n: number, m: Messages): string {
  return new Intl.NumberFormat(m.numberLocale).format(n);
}

function formatCop(n: number, m: Messages): string {
  return `COP ${formatNumber(n, m)}`;
}

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

/** `COP 1,197,000 – 1,463,000`, matching the documented display format. */
function estimateDisplay(low: number, high: number, m: Messages): string {
  return `${formatCop(low, m)} – ${formatNumber(high, m)}`;
}


/** Parsed in `America/Bogota`, so the bare date reads as the same day everywhere. */
function longDate(isoDate: string, m: Messages): string {
  return DateTime.fromISO(isoDate, { zone: 'America/Bogota' }).setLocale(m.dateLocale).toFormat(m.dateFormat);
}

interface Config {
  google: { leads_sheet_id: string; leads_tab: string };
  alerts: { error_email: string };
  team_locale?: unknown;
}

type SheetRow = Record<(typeof SHEET_HEADERS)[number], string | number>;

interface MapLeadOutput {
  row: SheetRow;
  team: { to: string; subject: string; text: string };
  customer: { to: string; reply_to: string; subject: string; html: string };
}

/**
 * Neither language can fail a lead: an invalid `team_locale` gives an English team alert with a
 * note, and a lead with no usable locale gets the default language.
 */
export function run(input: { lead: Lead; config: Config }): MapLeadOutput {
  const { lead, config } = input;
  const { customer, move, estimate } = lead;
  const teamLocale = teamLocaleOrDefault(config);
  const team = MESSAGES[teamLocale.locale];
  // Normalized again for a caller that skipped parseLead().
  const leadLocale: unknown = lead.locale;
  const forCustomer = MESSAGES[normalizeLocale(typeof leadLocale === 'string' ? leadLocale : '')];

  const receivedAt = DateTime.fromISO(lead.submitted_at).setZone('America/Bogota').toFormat('yyyy-LL-dd HH:mm');
  // eslint-disable-next-line security/detect-object-injection -- e is Extra, one of the label tables' own fixed keys, already validated by parseLead
  const extrasIn = (m: Messages): string => move.extras.map((e) => m.extras[e]).join(', ');

  const row: SheetRow = {
    received_at: receivedAt,
    reference: lead.reference,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    move_date: move.date,
    move_type: SHEET_MOVE_TYPE_LABELS[move.type],
    rooms: move.rooms,
    origin: move.origin,
    destination: move.destination,
    distance_km: move.distance_km,
    extras: extrasIn(MESSAGES.en),
    estimate_cop: estimate.amount,
    estimate_low_cop: estimate.low,
    estimate_high_cop: estimate.high,
    request_uuid: lead.request_uuid,
  };

  const teamExtras = extrasIn(team);
  const labels = team.teamLabels;
  const teamSubject = oneLine(team.teamSubject(lead.reference, move.origin, move.destination, move.date));
  // Plain text with no tel:/mailto: links: the email rule allows `?`, `&`, and `=` in the local
  // part, so a crafted lead could pre-fill a mailto reply. oneLine() stops forged lines.
  const teamText = [
    `${labels.name}: ${oneLine(customer.name)}`,
    `${labels.phone}: ${oneLine(customer.phone)}`,
    `${labels.email}: ${oneLine(customer.email)}`,
    `${labels.moveDate}: ${longDate(move.date, team)}`,
    `${labels.route}: ${team.route(oneLine(move.origin), oneLine(move.destination), oneLine(formatNumber(move.distance_km, team)))}`,
    `${labels.type}: ${team.moveTypes[move.type]}, ${oneLine(team.rooms(move.rooms))}`,
    `${labels.extras}: ${teamExtras === '' ? team.noExtras : teamExtras}`,
    `${labels.estimate}: ${estimateDisplay(estimate.low, estimate.high, team)}`,
    `${labels.reference}: ${oneLine(lead.reference)}`,
    ...(teamLocale.valid ? [] : [TEAM_LOCALE_NOTE]),
  ].join('\n');

  const customerSubject = oneLine(forCustomer.customerSubject(lead.site_name));
  const customerHtml = [
    `<p>${forCustomer.greeting(escapeHtml(customer.name))}</p>`,
    `<p>${forCustomer.estimateLine(estimateDisplay(estimate.low, estimate.high, forCustomer))}</p>`,
    `<p>${forCustomer.routeLine(escapeHtml(move.origin), escapeHtml(move.destination), longDate(move.date, forCustomer))}</p>`,
    `<p>${forCustomer.disclaimer}</p>`,
    `<p>${forCustomer.nextStep}</p>`,
    `<p>${forCustomer.referenceLine(escapeHtml(lead.reference))}</p>`,
  ].join('\n');

  return {
    row,
    team: { to: lead.team_email, subject: teamSubject, text: teamText },
    customer: { to: customer.email, reply_to: lead.team_email, subject: customerSubject, html: customerHtml },
  };
}
