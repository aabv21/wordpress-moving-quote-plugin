import { REFERENCE_QUERY_ARG } from './lib/reference.ts';
import { readSummary, sessionStore } from './lib/summary-store.ts';

/**
 * Fills the thank-you card's summary from what the form saved in this visitor's session, only for
 * the page's own reference; otherwise the card shows the reference alone.
 */
function fillThanks(card: HTMLElement): void {
  const reference = new URLSearchParams(window.location.search).get(REFERENCE_QUERY_ARG);
  const list = card.querySelector<HTMLElement>('[data-thanks-summary]');
  const storage = sessionStore();
  if (reference === null || !list || storage === null) return;

  const summary = readSummary(storage, reference);
  if (summary === null) return;

  const fill = (selector: string, text: string): void => {
    const element = list.querySelector(selector);
    if (element) element.textContent = text;
  };
  fill('[data-thanks-route]', summary.route);
  fill('[data-thanks-date]', summary.date);
  fill('[data-thanks-estimate]', summary.estimate);
  list.hidden = false;
}

document.querySelectorAll<HTMLElement>('[data-thanks]').forEach(fillThanks);
