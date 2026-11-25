import { postJson } from '../lib/api.ts';
import { firstStepWithError } from '../lib/form-state.ts';
import { leadReference } from '../lib/reference.ts';
import { saveSummary, sessionStore } from '../lib/summary-store.ts';
import type { ErrorView, QuoteFormConfig, Stepper } from './types.ts';
import { readValues } from './values.ts';

export interface SubmitDeps {
  form: HTMLFormElement;
  config: QuoteFormConfig;
  submissionId: string;
  stepper: Stepper;
  errors: ErrorView;
  onSuccess(reference: string | null): void;
}

/**
 * Posts the lead. Only a genuine 2xx calls `onSuccess` and leaves the button disabled; every other
 * outcome shows its message and re-enables it.
 */
export async function submitLead(deps: SubmitDeps): Promise<void> {
  const { form, config, errors, stepper } = deps;
  const submitButton = form.querySelector<HTMLButtonElement>('[data-submit]');
  const submitLabel = submitButton?.textContent ?? '';
  errors.clearAll();

  const values = readValues(form);
  const body = {
    submission_id: deps.submissionId,
    move_type: values.move_type,
    rooms: Number(values.rooms),
    origin: values.origin,
    destination: values.destination,
    move_date: values.move_date,
    extras: values.extras ?? [],
    name: values.name,
    phone: values.phone,
    email: values.email,
    consent: values.consent === true,
    website: (form.elements.namedItem('website') as HTMLInputElement | null)?.value ?? '',
  };

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = config.strings.sending;
  }

  const result = await postJson(config.leadsUrl, body, { 'X-WP-Nonce': config.nonce });

  if (result.ok) {
    const reference = leadReference(result.data);
    const storage = sessionStore();
    if (reference !== null && storage !== null) saveSummary(storage, { reference, ...summaryTexts(form, pricedDisplay(result.data)) });
    deps.onSuccess(reference);
    return;
  }

  if (submitButton) {
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
  }

  if (422 === result.status) {
    Object.entries(result.fieldErrors).forEach(([field, message]) => {
      errors.setField(field, message);
    });
    const step = firstStepWithError(result.fieldErrors);
    stepper.show(step, false);
    errors.setForm(config.strings.genericError);
    errors.focusFirstInvalid(stepper.fieldset(step));
    return;
  }

  if (403 === result.status) errors.setForm(config.strings.sessionExpired);
  else if (429 === result.status) errors.setForm(config.strings.rateLimited);
  else errors.setForm(0 === result.status ? config.strings.networkError : config.strings.serverError);
}

/** The estimate the server priced the saved lead at, from a 201's `estimate.display`. */
function pricedDisplay(data: unknown): string | null {
  const estimate = typeof data === 'object' && data !== null ? (data as { estimate?: unknown }).estimate : undefined;
  const display = typeof estimate === 'object' && estimate !== null ? (estimate as { display?: unknown }).display : undefined;
  return typeof display === 'string' && display !== '' ? display : null;
}

/**
 * What the thank-you page shows: the summary panel's route and date, and the server's own price
 * for the lead (the panel's when the response has none), which a debounce or a failed estimate
 * could have left stale or blank on screen.
 */
function summaryTexts(form: HTMLFormElement, priced: string | null): { route: string; date: string; estimate: string } {
  const text = (selector: string): string => form.querySelector(selector)?.textContent.trim() ?? '';
  return { route: text('[data-summary-route]'), date: text('[data-summary-date]'), estimate: priced ?? text('[data-estimate-value]') };
}

/**
 * For a missing thank-you page. Moves focus onto the message, so a screen reader reads it and
 * focus isn't stranded on the hidden submit button.
 */
export function showInlineSuccess(form: HTMLFormElement, reference: string | null): void {
  const successRegion = form.querySelector<HTMLElement>('[data-success]');
  if (!successRegion) return;
  // Everything but the message and the wrappers around it.
  for (let node: HTMLElement = successRegion; node !== form && node.parentElement; node = node.parentElement) {
    Array.from(node.parentElement.children).forEach((sibling) => {
      if (sibling instanceof HTMLElement && sibling !== node) sibling.hidden = true;
    });
  }
  const referenceLine = successRegion.querySelector<HTMLElement>('[data-success-reference]');
  const referenceValue = successRegion.querySelector<HTMLElement>('[data-success-reference-value]');
  if (reference !== null && referenceLine && referenceValue) {
    referenceValue.textContent = reference;
    referenceLine.hidden = false;
  }
  successRegion.hidden = false;
  successRegion.focus();
}
