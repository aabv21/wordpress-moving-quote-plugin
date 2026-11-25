import { postJson } from '../lib/api.ts';
import { firstStepWithError } from '../lib/form-state.ts';
import { leadReference } from '../lib/reference.ts';
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
    deps.onSuccess(leadReference(result.data));
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

/**
 * For a missing thank-you page. Moves focus onto the message, so a screen reader reads it and
 * focus isn't stranded on the hidden submit button.
 */
export function showInlineSuccess(form: HTMLFormElement, reference: string | null): void {
  const successRegion = form.querySelector<HTMLElement>('[data-success]');
  if (!successRegion) return;
  Array.from(form.children).forEach((child) => {
    if (child instanceof HTMLElement && child !== successRegion) child.hidden = true;
  });
  const referenceLine = successRegion.querySelector<HTMLElement>('[data-success-reference]');
  const referenceValue = successRegion.querySelector<HTMLElement>('[data-success-reference-value]');
  if (reference !== null && referenceLine && referenceValue) {
    referenceValue.textContent = reference;
    referenceLine.hidden = false;
  }
  successRegion.hidden = false;
  successRegion.focus();
}
