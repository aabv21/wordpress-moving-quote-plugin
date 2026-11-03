import { postJson } from './lib/api.ts';
import { debounce } from './lib/debounce.ts';
import { affectsEstimate } from './lib/estimate-display.ts';
import { createEstimateFetcher } from './lib/estimate-fetch.ts';
import { estimateRequest, firstStepWithError, missingRequired } from './lib/form-state.ts';
import type { FormValues } from './lib/form-state.ts';
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
    successInline: string;
  };
}

const TOTAL_STEPS = 3;
const ESTIMATE_DEBOUNCE_MS = 300;

/** Reads and parses a form's `data-config` attribute. */
function readConfig(form: HTMLFormElement): QuoteFormConfig {
  const raw = form.dataset['config'];
  if (raw === undefined) throw new Error('moving-quote: missing data-config');
  return JSON.parse(raw) as QuoteFormConfig;
}

/** A named field's current string value, or '' when the form has no such field (or it's a file input, which this form never uses). */
function fieldValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

/** The current value of every field this form collects, read straight off the DOM. */
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

/** Wires one `[moving_quote]` form: step navigation, the live estimate, and the submit flow. */
function initQuoteForm(form: HTMLFormElement): void {
  const config = readConfig(form);
  const submissionId = uuidV4();

  const fieldsets = Array.from(form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-step]'));
  const progressItems = Array.from(form.querySelectorAll<HTMLLIElement>('[data-progress-step]'));
  const estimateRegion = form.querySelector<HTMLElement>('.moving-quote__estimate');
  const estimateValue = estimateRegion?.querySelector<HTMLElement>('[data-estimate-value]') ?? null;
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

  const fetchEstimate = createEstimateFetcher(config.estimateUrl, (text) => {
    if (estimateValue) estimateValue.textContent = text;
  });

  // debounce()'s callback is declared void-returning; the promise fetchEstimate() produces is
  // caught right here; nothing above is dropped.
  const runEstimate = debounce(() => {
    const request = estimateRequest(readValues(form));
    if (!request) return;
    fetchEstimate(request).catch(() => undefined);
  }, ESTIMATE_DEBOUNCE_MS);

  // The name, phone, and email fields never affect price: filtering them out here (rather than
  // in fetchEstimate itself) means a keystroke in any of them never even debounces a call that
  // would just return early, let alone spend a request against the estimate rate limit.
  function onFieldEvent(event: Event): void {
    const target = event.target;
    const fieldName = target instanceof HTMLElement ? target.getAttribute('name') : null;
    if (fieldName !== null && !affectsEstimate(fieldName)) return;
    runEstimate();
  }

  form.addEventListener('input', onFieldEvent);
  form.addEventListener('change', onFieldEvent);

  form.querySelectorAll<HTMLButtonElement>('[data-next]').forEach((button) => {
    button.addEventListener('click', () => {
      const missing = missingRequired(currentStep as 0 | 1 | 2, readValues(form));
      const firstMissing = missing[0];
      if (firstMissing !== undefined) {
        // <fieldset> never participates in constraint validation (its own reportValidity() is a
        // no-op); the control itself is what can show the browser's native validation message.
        const control = form.elements.namedItem(firstMissing);
        if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) {
          control.reportValidity();
        }
        return;
      }
      showStep(Math.min(currentStep + 1, TOTAL_STEPS - 1), true);
    });
  });

  form.querySelectorAll<HTMLButtonElement>('[data-back]').forEach((button) => {
    button.addEventListener('click', () => {
      showStep(Math.max(currentStep - 1, 0), true);
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
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
      if (config.thankYouUrl) {
        window.location.assign(config.thankYouUrl);
      } else {
        form.hidden = true;
        if (errorRegion) {
          errorRegion.textContent = config.strings.successInline;
          errorRegion.setAttribute('role', 'status');
        }
      }
      return;
    }

    reenableSubmit();

    if (422 === result.status) {
      Object.entries(result.fieldErrors).forEach(([field, message]) => {
        setFieldError(field, message);
      });
      showStep(firstStepWithError(result.fieldErrors), true);
      setFormError(config.strings.genericError);
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

  showStep(0, false);
}

document.querySelectorAll<HTMLFormElement>('form[data-moving-quote]').forEach(initQuoteForm);
