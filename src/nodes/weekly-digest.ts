import { isSimpleEmail, oneLine } from './lead.ts';
import { BUSINESS_TIMEZONE, TEAM_LOCALE_NOTE, teamLocaleOrDefault, type Locale } from './locale.ts';

const MOVE_TYPES = ['Apartment', 'House', 'Office'] as const;
const WINDOW_DAYS = 7;
const MAX_ROUTES = 3;

interface DigestMessages {
  numberLocale: string;
  subject: (count: string, from: string, to: string) => string;
  leads: string;
  value: string;
  average: string;
  notAvailable: string;
  routes: string;
  none: string;
  routeValue: (origin: string, destination: string, count: number) => string;
  byType: string;
  moveTypes: Record<(typeof MOVE_TYPES)[number], string>;
  sheet: string;
}

export const DIGEST_MESSAGES: Record<Locale, DigestMessages> = {
  en: {
    numberLocale: 'en-US',
    subject: (count, from, to) => `[Chivabox Movers] Weekly summary: ${count} leads, ${from} to ${to}`,
    leads: 'Leads',
    value: 'Estimated value',
    average: 'Average estimate',
    notAvailable: 'n/a',
    routes: 'Top routes',
    none: 'none',
    routeValue: (origin, destination, count) => `${origin} to ${destination} (${String(count)})`,
    byType: 'By move type',
    moveTypes: { Apartment: 'Apartment', House: 'House', Office: 'Office' },
    sheet: 'Sheet',
  },
  es: {
    numberLocale: 'es-CO',
    subject: (count, from, to) => `[Chivabox Movers] Resumen semanal: ${count} solicitudes, del ${from} al ${to}`,
    leads: 'Solicitudes',
    value: 'Valor estimado',
    average: 'Estimado promedio',
    notAvailable: 'no aplica',
    routes: 'Rutas principales',
    none: 'ninguna',
    routeValue: (origin, destination, count) => `${origin} a ${destination} (${String(count)})`,
    byType: 'Por tipo',
    moveTypes: { Apartment: 'Apartamento', House: 'Casa', Office: 'Oficina' },
    sheet: 'Hoja',
  },
};

interface DigestInput {
  config: { team_locale?: unknown; digest_email?: unknown; google?: { leads_sheet_id?: unknown } };
  rows: unknown[];
  /** An ISO timestamp, read in the business time zone. */
  now: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A sheet cell as text; anything that isn't a string or number reads as ''. */
function cell(row: Record<string, unknown>, key: string): string {
  // eslint-disable-next-line security/detect-object-injection -- key is always a fixed literal from this file
  const value = row[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

interface Counted {
  estimate: number;
  route: { origin: string; destination: string };
  moveType: string;
}

/** A row counts when its `received_at` falls in `[start, end)` and its estimate is a number. */
function countedRow(raw: unknown, start: DateTime, end: DateTime): Counted | null {
  if (!isRecord(raw)) return null;
  const receivedAt = DateTime.fromFormat(cell(raw, 'received_at'), 'yyyy-LL-dd HH:mm', { zone: BUSINESS_TIMEZONE });
  const estimateText = cell(raw, 'estimate_cop').trim();
  const estimate = Number(estimateText);
  if (!receivedAt.isValid || receivedAt < start || receivedAt >= end) return null;
  if (estimateText === '' || !Number.isFinite(estimate)) return null;

  return { estimate, route: { origin: oneLine(cell(raw, 'origin')), destination: oneLine(cell(raw, 'destination')) }, moveType: cell(raw, 'move_type') };
}

/**
 * The seven whole Bogota days before today's midnight, as a plain-text summary in `team_locale`.
 * Throws when `digest_email` is missing or not a simple email, so the error workflow alerts
 * instead of a mail going nowhere.
 */
export function run(input: DigestInput): { to: string; subject: string; text: string } {
  const { config, rows, now } = input;
  const to = config.digest_email;
  if (to === undefined || to === '') throw new Error('config.digest_email is not set');
  if (typeof to !== 'string' || !isSimpleEmail(to)) throw new Error('config.digest_email is not a simple email address');

  const teamLocale = teamLocaleOrDefault(config);
  const m = DIGEST_MESSAGES[teamLocale.locale];
  const number = (n: number): string => new Intl.NumberFormat(m.numberLocale).format(n);

  // Whole Bogota days, so the counted rows are exactly the dates the subject names.
  const end = DateTime.fromISO(now, { zone: BUSINESS_TIMEZONE }).startOf('day');
  const start = end.minus({ days: WINDOW_DAYS });
  const counted = rows.map((row) => countedRow(row, start, end)).filter((row): row is Counted => row !== null);

  const sum = counted.reduce((total, row) => total + row.estimate, 0);
  const average = counted.length === 0 ? m.notAvailable : `COP ${number(Math.round(sum / counted.length / 1000) * 1000)}`;

  const perRoute = new Map<string, { origin: string; destination: string; count: number }>();
  for (const { route } of counted) {
    const key = `${route.origin}\u0000${route.destination}`;
    perRoute.set(key, { ...route, count: (perRoute.get(key)?.count ?? 0) + 1 });
  }
  const topRoutes = [...perRoute.entries()]
    .sort(([keyA, a], [keyB, b]) => b.count - a.count || (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .slice(0, MAX_ROUTES)
    .map(([, route]) => m.routeValue(route.origin, route.destination, route.count));

  // eslint-disable-next-line security/detect-object-injection -- type comes from MOVE_TYPES, this file's own fixed keys
  const byType = MOVE_TYPES.map((type) => `${m.moveTypes[type]} ${String(counted.filter((row) => row.moveType === type).length)}`);
  const sheetId = config.google?.leads_sheet_id;

  const text = [
    `${m.leads}: ${String(counted.length)}`,
    `${m.value}: COP ${number(sum)}`,
    `${m.average}: ${average}`,
    `${m.routes}: ${topRoutes.length === 0 ? m.none : topRoutes.join(', ')}`,
    `${m.byType}: ${byType.join(', ')}`,
    ...(typeof sheetId === 'string' && sheetId !== '' ? [`${m.sheet}: https://docs.google.com/spreadsheets/d/${oneLine(sheetId)}`] : []),
    ...(teamLocale.valid ? [] : [TEAM_LOCALE_NOTE]),
  ].join('\n');

  const subject = m.subject(number(counted.length), start.toFormat('yyyy-LL-dd'), end.minus({ days: 1 }).toFormat('yyyy-LL-dd'));
  return { to, subject: oneLine(subject), text };
}
