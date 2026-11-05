import { postJson } from './lib/api.ts';
import { debounce } from './lib/debounce.ts';
import { affectsEstimate, ESTIMATE_PLACEHOLDER } from './lib/estimate-display.ts';
import type { EstimateOutcome } from './lib/estimate-display.ts';
import { createEstimateFetcher } from './lib/estimate-fetch.ts';
import { estimateRequest, firstStepWithError, missingRequired } from './lib/form-state.ts';
import type { FormValues } from './lib/form-state.ts';
import { leadReference, thankYouHref } from './lib/reference.ts';
import { uuidV4 } from './lib/uuid.ts';

interface QuoteFormConfig {
  estimateUrl: string;
  leadsUrl: string;
  nonce: string;
  thankYouUrl: string | null;
  strings: {
    sending: string;
    networkError: string;
    rateLimited: string;
    sessionExpired: string;
    genericError: string;
  };
}

type EstimateState = 'idle' | 'loading' | EstimateOutcome;

const TOTAL_STEPS = 3;
const ESTIMATE_DEBOUNCE_MS = 300;

function readConfig(form: HTMLFormElement): QuoteFormConfig {
  const raw = form.dataset['config'];
  if (raw === undefined) throw new Error('moving-quote: missing data-config');
  return JSON.parse(raw) as QuoteFormConfig;
}

/** '' when the field is missing (or a file input, which this form never uses). */
function fieldValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

function readValues(form: HTMLFormElement): FormValues {
  const data = new FormData(form);
  const extras = data.getAll('extras').filter((value): value is string => typeof value === 'string');
  return {
    move_type: fieldValue(data, 'move_type'),
    rooms: fieldValue(data, 'rooms'),
    origin: fieldValue(data, 'origin'),
    destination: fieldValue(data, 'destination'),
    move_date: fieldValue(data, 'move_date'),
    extras,
    name: fieldValue(data, 'name'),
    phone: fieldValue(data, 'phone'),
    email: fieldValue(data, 'email'),
    consent: null !== data.get('consent'),
  };
}

function initQuoteForm(form: HTMLFormElement): void {
  const config = readConfig(form);
  const submissionId = uuidV4();

  const fieldsets = Array.from(form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-step]'));
  const progressItems = Array.from(form.querySelectorAll<HTMLLIElement>('[data-progress-step]'));
  const estimateRegion = form.querySelector<HTMLElement>('.moving-quote__estimate');
  const estimateValue = estimateRegion?.querySelector<HTMLElement>('[data-estimate-value]') ?? null;
  const estimateResult = estimateRegion?.querySelector<HTMLElement>('[data-estimate-result]') ?? null;
  const estimateError = estimateRegion?.querySelector<HTMLElement>('[data-estimate-error]') ?? null;
  const estimateHint = estimateRegion?.querySelector<HTMLElement>('[data-estimate-hint]') ?? null;
  const successRegion = form.querySelector<HTMLElement>('[data-success]');
  const errorRegion = form.querySelector<HTMLElement>('[data-form-error]');
  const submitButton = form.querySelector<HTMLButtonElement>('[data-submit]');
  const submitLabel = submitButton?.textContent ?? '';

  let currentStep = 0;

  function showStep(step: number, focusLegend: boolean): void {
    currentStep = step;
    fieldsets.forEach((fieldset, index) => {
      fieldset.hidden = index !== step;
    });
    progressItems.forEach((item, index) => {
      if (index === step) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    if (focusLegend) {
      fieldsets[step]?.querySelector('legend')?.focus();
    }
  }

  function setFieldError(field: string, message: string | undefined): void {
    const input = form.elements.namedItem(field);
    const describedEl = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
    if (!describedEl) return;
    describedEl.textContent = message ?? '';
    if (input instanceof HTMLElement) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  function clearFieldErrors(): void {
    form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => {
      el.textContent = '';
    });
    form.querySelectorAll('[aria-invalid]').forEach((el) => {
      el.removeAttribute('aria-invalid');
    });
  }

  function setFormError(message: string): void {
    if (errorRegion) errorRegion.textContent = message;
  }

  function clearFormError(): void {
    if (errorRegion) errorRegion.textContent = '';
  }

  /**
   * `aria-busy` holds the live region's announcement while loading, so a burst of edits is
   * announced once, with its final result.
   */
  function setEstimateState(state: EstimateState): void {
    if (!estimateRegion) return;
    estimateRegion.dataset['estimateState'] = state;
    if (state === 'loading') estimateResult?.setAttribute('aria-busy', 'true');
    else estimateResult?.removeAttribute('aria-busy');
    if (estimateError) estimateError.hidden = state !== 'error';
    if (estimateHint) estimateHint.hidden = state !== 'idle';
  }

  function showEstimate(text: string, outcome: EstimateOutcome): void {
    // An unchanged range isn't rewritten, so the live region doesn't announce the same price again.
    if (estimateValue && estimateValue.textContent !== text) estimateValue.textContent = text;
    setEstimateState(outcome);
  }

  const fetchEstimate = createEstimateFetcher(config.estimateUrl, showEstimate);

  // postJson() never rejects, so this catch only keeps the panel from staying in its loading state.
  const runEstimate = debounce(() => {
    const request = estimateRequest(readValues(form));
    if (!request) return;
    setEstimateState('loading');
    fetchEstimate(request).catch(() => {
      showEstimate(ESTIMATE_PLACEHOLDER, 'error');
    });
  }, ESTIMATE_DEBOUNCE_MS);

  // Filtered before debouncing, so a keystroke in name, phone, or email never schedules a call.
  function onFieldEvent(event: Event): void {
    const target = event.target;
    const fieldName = target instanceof HTMLElement ? target.getAttribute('name') : null;
    if (fieldName !== null && !affectsEstimate(fieldName)) return;
    runEstimate();
  }

  form.addEventListener('input', onFieldEvent);
  form.addEventListener('change', onFieldEvent);

  function goNext(): void {
    const missing = missingRequired(currentStep as 0 | 1 | 2, readValues(form));
    const firstMissing = missing[0];
    if (firstMissing !== undefined) {
      // A <fieldset>'s reportValidity() is a no-op; only the control shows the native message.
      const control = form.elements.namedItem(firstMissing);
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
        control.reportValidity();
      }
      return;
    }
    showStep(Math.min(currentStep + 1, TOTAL_STEPS - 1), true);
  }

  form.querySelectorAll<HTMLButtonElement>('[data-next]').forEach((button) => {
    button.addEventListener('click', goNext);
  });

  form.querySelectorAll<HTMLButtonElement>('[data-back]').forEach((button) => {
    button.addEventListener('click', () => {
      showStep(Math.max(currentStep - 1, 0), true);
    });
  });

  // Enter submits implicitly; before the last step it means "Next", not a premature submit.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (currentStep < TOTAL_STEPS - 1) {
      goNext();
      return;
    }
    void submit();
  });

  async function submit(): Promise<void> {
    clearFieldErrors();
    clearFormError();

    const values = readValues(form);
    const body = {
      submission_id: submissionId,
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
      if (config.thankYouUrl) {
        window.location.assign(thankYouHref(config.thankYouUrl, reference, window.location.href));
      } else {
        showSuccess(reference);
      }
      return;
    }

    reenableSubmit();

    if (422 === result.status) {
      Object.entries(result.fieldErrors).forEach(([field, message]) => {
        setFieldError(field, message);
      });
      const step = firstStepWithError(result.fieldErrors);
      showStep(step, false);
      setFormError(config.strings.genericError);
      focusFirstInvalid(step);
      return;
    }

    if (403 === result.status) {
      setFormError(config.strings.sessionExpired);
      return;
    }

    if (429 === result.status) {
      setFormError(config.strings.rateLimited);
      return;
    }

    setFormError(config.strings.networkError);
  }

  function reenableSubmit(): void {
    if (!submitButton) return;
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
  }

  /** Falls back to the step's legend when no single control carries the error (e.g. `extras`). */
  function focusFirstInvalid(step: number): void {
    const fieldset = fieldsets[step];
    const invalid = fieldset?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) invalid.focus();
    else fieldset?.querySelector('legend')?.focus();
  }

  /**
   * For a missing thank-you page. Moves focus onto the message, so a screen reader reads it and
   * focus isn't stranded on the hidden submit button.
   */
  function showSuccess(reference: string | null): void {
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

  showStep(0, false);
}

document.querySelectorAll<HTMLFormElement>('form[data-moving-quote]').forEach(initQuoteForm);
