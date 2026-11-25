import { readValues } from './values.ts';

/** `YYYY-MM-DD` as the page's language writes a date (`15/12/2026` in Spanish), or as typed when it doesn't parse. */
export function formatMoveDate(isoDate: string, lang: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  try {
    return new Intl.DateTimeFormat(lang === '' ? undefined : lang, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
  } catch {
    return isoDate; // an unknown language tag
  }
}

/**
 * Keeps the summary panel's route, date and extras in step with the form. Each line starts with
 * the server's translated placeholder, marked `data-empty` so it reads as a hint, and shows it
 * again, marked, whenever its field is cleared.
 */
export function watchSummary(form: HTMLFormElement): void {
  const route = form.querySelector<HTMLElement>('[data-summary-route]');
  const date = form.querySelector<HTMLElement>('[data-summary-date]');
  const extras = form.querySelector<HTMLElement>('[data-summary-extras]');
  const placeholders = { route: route?.textContent ?? '', date: date?.textContent ?? '', extras: extras?.textContent ?? '' };
  const lang = document.documentElement.lang;

  const update = (): void => {
    const values = readValues(form);
    const checked = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="extras"]:checked'));
    const labels = checked.map((box) => box.closest('label')?.querySelector('.moving-quote__option-label')?.textContent.trim() ?? box.value);
    const { origin = '', destination = '', move_date: moveDate = '' } = values;
    setLine(route, origin !== '' && destination !== '' ? `${origin} → ${destination}` : null, placeholders.route);
    setLine(date, moveDate !== '' ? formatMoveDate(moveDate, lang) : null, placeholders.date);
    setLine(extras, labels.length > 0 ? labels.join(', ') : null, placeholders.extras);
  };

  form.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}

/** The value, or the placeholder marked `data-empty` when there's none yet. */
function setLine(element: HTMLElement | null, value: string | null, placeholder: string): void {
  if (!element) return;
  const text = value ?? placeholder;
  if (element.textContent !== text) element.textContent = text;
  element.toggleAttribute('data-empty', value === null);
}
