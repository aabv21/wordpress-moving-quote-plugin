import { oneLine, type Lead } from './lead.ts';
import { BUSINESS_TIMEZONE, normalizeLocale, TEAM_LOCALE_NOTE, teamLocaleOrDefault } from './locale.ts';
import { MESSAGES, type Messages } from './messages.ts';

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

/**
 * `https://wa.me/<digits>` for the visitor's number. A Colombian mobile typed without the country
 * code (10 digits starting with 3) gets `57` in front; every other number is used as it is. Built
 * only from the digits `parseLead()` validated, so it is the one link a team email carries.
 */
export function whatsAppLink(phone: string): string {
  const digits = /^3\d{9}$/.test(phone) ? `57${phone}` : phone;

  return `https://wa.me/${digits}`;
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
    ...(lead.status_url === '' ? [] : [emailRow(`<a href="${escapeHtml(lead.status_url)}">${m.statusLink}</a>`, body)]),
    ...(contact.phone === '' ? [] : [emailRow(m.questions(formatPhoneDisplay(contact.phone), whatsAppLink), body)]),
    ...(siteName === '' ? [] : [emailRow(m.demoNotice(siteName), `padding:24px 0 0;font-size:12px;color:${EMAIL_MUTED}`)]),
    '</table>',
  ].join('\n');
}

/** Parsed in the business time zone, so the bare date reads as the same day everywhere. */
function longDate(isoDate: string, m: Messages): string {
  return DateTime.fromISO(isoDate, { zone: BUSINESS_TIMEZONE }).setLocale(m.dateLocale).toFormat(m.dateFormat);
}

export interface Config {
  google: { leads_sheet_id: string; leads_tab: string };
  alerts: { error_email: string };
  team_locale?: unknown;
}

/**
 * Plain text with no tel:/mailto: links: the email rule allows `?`, `&`, and `=` in the local
 * part, so a crafted lead could pre-fill a mailto reply. oneLine() stops forged lines. An invalid
 * `team_locale` gives an English email with a note, never a failed lead.
 */
export function buildTeamEmail(lead: Lead, config: Pick<Config, 'team_locale'>): { to: string; subject: string; text: string } {
  const { customer, move, estimate } = lead;
  const teamLocale = teamLocaleOrDefault(config);
  const team = MESSAGES[teamLocale.locale];
  // eslint-disable-next-line security/detect-object-injection -- e is Extra, one of the label tables' own fixed keys, already validated by parseLead
  const extras = move.extras.map((e) => team.extras[e]).join(', ');
  const labels = team.teamLabels;

  const text = [
    `${labels.name}: ${oneLine(customer.name)}`,
    `${labels.phone}: ${oneLine(customer.phone)}`,
    `${labels.whatsapp}: ${whatsAppLink(customer.phone)}`,
    `${labels.email}: ${oneLine(customer.email)}`,
    `${labels.moveDate}: ${longDate(move.date, team)}`,
    `${labels.route}: ${team.route(oneLine(move.origin), oneLine(move.destination), oneLine(formatNumber(move.distance_km, team)))}`,
    `${labels.type}: ${team.moveTypes[move.type]}, ${oneLine(team.rooms(move.rooms))}`,
    `${labels.extras}: ${extras === '' ? team.noExtras : extras}`,
    `${labels.estimate}: ${estimateDisplay(estimate.low, estimate.high, team)}`,
    `${labels.reference}: ${oneLine(lead.reference)}`,
    ...(teamLocale.valid ? [] : [TEAM_LOCALE_NOTE]),
  ].join('\n');

  return { to: lead.team_email, subject: oneLine(team.teamSubject(lead.reference, move.origin, move.destination, move.date)), text };
}

/** In the lead's own language; a caller that skipped parseLead() still gets the default. */
export function buildCustomerEmail(lead: Lead): { to: string; reply_to: string; subject: string; html: string } {
  const leadLocale: unknown = lead.locale;
  const messages = MESSAGES[normalizeLocale(typeof leadLocale === 'string' ? leadLocale : '')];

  return {
    to: lead.customer.email,
    reply_to: lead.team_email,
    subject: oneLine(messages.customerSubject(lead.site_name)),
    html: customerEmail(lead, messages),
  };
}
