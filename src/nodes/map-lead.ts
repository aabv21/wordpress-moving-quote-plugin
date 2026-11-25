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
  customerLabels: { estimate: string; route: string; moveDate: string; moveType: string; extras: string; reference: string };
  routeValue: (origin: string, destination: string) => string;
  disclaimer: string;
  nextStep: string;
  /** `whatsAppLink` is an `<a>` already built from validated digits, or '' to leave that half out. */
  questions: (phone: string, whatsAppLink: string) => string;
  demoNotice: (siteName: string) => string;
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
    customerLabels: { estimate: 'Your estimate', route: 'Route', moveDate: 'Move date', moveType: 'Move type', extras: 'Extras', reference: 'Reference' },
    routeValue: (origin, destination) => `${origin} to ${destination}`,
    disclaimer: 'This is an estimate. We confirm the final price after a visit or video call.',
    nextStep: 'A member of our team will call you to schedule a short visit or video call and confirm the final price.',
    questions: (phone, whatsAppLink) => (whatsAppLink === '' ? `Questions? Call us at ${phone}.` : `Questions? Call us at ${phone} or write on WhatsApp: ${whatsAppLink}`),
    demoNotice: (siteName) => `${siteName} is a fictional company for a portfolio demo.`,
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
    customerLabels: { estimate: 'Su estimado', route: 'Ruta', moveDate: 'Fecha de la mudanza', moveType: 'Tipo', extras: 'Servicios adicionales', reference: 'Referencia' },
    routeValue: (origin, destination) => `${origin} a ${destination}`,
    disclaimer: 'Este valor es un estimado. Confirmamos el precio final después de una visita o una videollamada.',
    nextStep: 'Una persona de nuestro equipo se comunicará con usted para programar una visita corta o una videollamada y confirmar el precio final.',
    questions: (phone, whatsAppLink) => (whatsAppLink === '' ? `¿Preguntas? Llámenos al ${phone}.` : `¿Preguntas? Llámenos al ${phone} o escríbanos por WhatsApp: ${whatsAppLink}`),
    demoNotice: (siteName) => `${siteName} es una empresa ficticia para una demostración de portafolio.`,
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


/**
 * `570000000099` → `+57 000 000 0099`; any other number is `+` and its digits. Mirrors the
 * plugin's `Settings\Business::display()`, so the email shows the number as the site does.
 */
export function formatPhoneDisplay(digits: string): string {
  if (digits === '') return '';
  if (digits.length === 12 && digits.startsWith('57')) return `+57 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return `+${digits}`;
}

/** The brand's colors, inline: most email clients drop `<style>` blocks. */
const EMAIL_TEXT = '#111418';
const EMAIL_MUTED = '#4b5563';
const EMAIL_ACCENT = '#1d4ed8';
const EMAIL_BORDER = '#d4d4d8';

function emailRow(html: string, style: string): string {
  return `<tr><td style="${style}">${html}</td></tr>`;
}

/**
 * One readable column, as a table with inline styles, the layout email clients render alike. Every
 * value from the lead is escaped here; the numbers were validated as digits by `parseLead()`.
 */
function customerEmail(lead: Lead, m: Messages): string {
  const { customer, move, estimate, contact } = lead;
  const labels = m.customerLabels;
  // eslint-disable-next-line security/detect-object-injection -- e is Extra, one of the label table's own fixed keys, validated by parseLead
  const extras = move.extras.map((e) => m.extras[e]).join(', ');
  const cell = `padding:8px 12px 8px 0;border-top:1px solid ${EMAIL_BORDER}`;
  const details = (
    [
      [labels.route, m.routeValue(escapeHtml(move.origin), escapeHtml(move.destination))],
      [labels.moveDate, longDate(move.date, m)],
      [labels.moveType, `${m.moveTypes[move.type]}, ${m.rooms(move.rooms)}`],
      [labels.extras, extras === '' ? m.noExtras : extras],
      [labels.reference, escapeHtml(lead.reference)],
    ] as const
  )
    .map(([label, value]) => `<tr><td style="${cell};width:40%;color:${EMAIL_MUTED}">${label}</td>\n<td style="${cell}">${value}</td></tr>`)
    .join('\n');
  const whatsAppLink = contact.whatsapp === '' ? '' : `<a href="https://wa.me/${contact.whatsapp}">wa.me/${contact.whatsapp}</a>`;
  const body = 'padding:16px 0 0;font-size:16px;line-height:1.5';
  const siteName = escapeHtml(lead.site_name);

  return [
    `<table role="presentation" width="100%" style="max-width:560px;font-family:Arial,Helvetica,sans-serif;color:${EMAIL_TEXT}">`,
    ...(siteName === '' ? [] : [emailRow(siteName, `padding:0 0 12px;font-size:20px;font-weight:700;border-bottom:3px solid ${EMAIL_ACCENT}`)]),
    emailRow(m.greeting(escapeHtml(customer.name)), body),
    emailRow(labels.estimate, `padding:16px 0 0;font-size:14px;color:${EMAIL_MUTED}`),
    emailRow(estimateDisplay(estimate.low, estimate.high, m), 'padding:4px 0 0;font-size:24px;font-weight:700'),
    emailRow(`<table role="presentation" width="100%" style="border-collapse:collapse;font-size:15px;line-height:1.4">\n${details}\n</table>`, 'padding:16px 0 0'),
    emailRow(m.disclaimer, body),
    emailRow(m.nextStep, body),
    ...(contact.phone === '' ? [] : [emailRow(m.questions(formatPhoneDisplay(contact.phone), whatsAppLink), body)]),
    ...(siteName === '' ? [] : [emailRow(m.demoNotice(siteName), `padding:24px 0 0;font-size:12px;color:${EMAIL_MUTED}`)]),
    '</table>',
  ].join('\n');
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
  const customerHtml = customerEmail(lead, forCustomer);

  return {
    row,
    team: { to: lead.team_email, subject: teamSubject, text: teamText },
    customer: { to: customer.email, reply_to: lead.team_email, subject: customerSubject, html: customerHtml },
  };
}
