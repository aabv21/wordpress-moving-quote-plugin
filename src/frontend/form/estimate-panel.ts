import { debounce } from '../lib/debounce.ts';
import { affectsEstimate, ESTIMATE_PLACEHOLDER } from '../lib/estimate-display.ts';
import { createEstimateFetcher } from '../lib/estimate-fetch.ts';
import { estimateRequest } from '../lib/form-state.ts';
import type { EstimatePanel } from './types.ts';
import { readValues } from './values.ts';

const ESTIMATE_DEBOUNCE_MS = 300;

export function createEstimatePanel(form: HTMLFormElement): EstimatePanel {
  const region = form.querySelector<HTMLElement>('.moving-quote__estimate');
  const value = region?.querySelector<HTMLElement>('[data-estimate-value]') ?? null;
  const result = region?.querySelector<HTMLElement>('[data-estimate-result]') ?? null;
  const error = region?.querySelector<HTMLElement>('[data-estimate-error]') ?? null;
  const hint = region?.querySelector<HTMLElement>('[data-estimate-hint]') ?? null;

  const panel: EstimatePanel = {
    /**
     * `aria-busy` holds the live region's announcement while loading, so a burst of edits is
     * announced once, with its final result.
     */
    setState(state) {
      if (!region) return;
      region.dataset['estimateState'] = state;
      if (state === 'loading') result?.setAttribute('aria-busy', 'true');
      else result?.removeAttribute('aria-busy');
      if (error) error.hidden = state !== 'error';
      if (hint) hint.hidden = state !== 'idle';
    },
    show(text, outcome) {
      // An unchanged range isn't rewritten, so the live region doesn't announce the same price again.
      if (value && value.textContent !== text) value.textContent = text;
      panel.setState(outcome);
    },
  };
  return panel;
}

/**
 * Asks for an estimate, debounced, whenever a pricing field changes. Returns the debounced call,
 * so the form can also ask once on load.
 */
export function watchEstimates(form: HTMLFormElement, estimateUrl: string, panel: EstimatePanel): () => void {
  const fetchEstimate = createEstimateFetcher(estimateUrl, panel.show);

  // postJson() never rejects, so this catch only keeps the panel from staying in its loading state.
  const runEstimate = debounce(() => {
    const request = estimateRequest(readValues(form));
    if (!request) return;
    panel.setState('loading');
    fetchEstimate(request).catch(() => {
      panel.show(ESTIMATE_PLACEHOLDER, 'error');
    });
  }, ESTIMATE_DEBOUNCE_MS);

  // Filtered before debouncing, so a keystroke in name, phone, or email never schedules a call.
  const onFieldEvent = (event: Event): void => {
    const name = event.target instanceof HTMLElement ? event.target.getAttribute('name') : null;
    if (name === null || affectsEstimate(name)) runEstimate();
  };
  form.addEventListener('input', onFieldEvent);
  form.addEventListener('change', onFieldEvent);
  return runEstimate;
}
