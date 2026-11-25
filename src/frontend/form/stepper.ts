import { missingRequired } from '../lib/form-state.ts';
import type { Stepper } from './types.ts';
import { readValues } from './values.ts';

export function createStepper(form: HTMLFormElement): Stepper {
  const fieldsets = Array.from(form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-step]'));
  const progressItems = Array.from(form.querySelectorAll<HTMLLIElement>('[data-progress-step]'));
  let currentStep = 0;

  return {
    count: fieldsets.length,
    current: () => currentStep,
    fieldset: (step) => fieldsets[step],
    show(step, focusLegend) {
      currentStep = step;
      fieldsets.forEach((fieldset, index) => {
        fieldset.hidden = index !== step;
      });
      progressItems.forEach((item, index) => {
        if (index === step) item.setAttribute('aria-current', 'step');
        else item.removeAttribute('aria-current');
      });
      if (focusLegend) fieldsets[step]?.querySelector('legend')?.focus();
    },
  };
}

/** Moves to the next step, or shows the native message on the first missing control. */
export function goNext(form: HTMLFormElement, stepper: Stepper): void {
  const firstMissing = missingRequired(stepper.current() as 0 | 1 | 2, readValues(form))[0];
  if (firstMissing !== undefined) {
    // A <fieldset>'s reportValidity() is a no-op; only the control shows the native message.
    const control = form.elements.namedItem(firstMissing);
    if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement) control.reportValidity();
    return;
  }
  stepper.show(Math.min(stepper.current() + 1, stepper.count - 1), true);
}

/** Wires every Next and Back button; returns the "Next" action for the submit handler. */
export function wireStepButtons(form: HTMLFormElement, stepper: Stepper): () => void {
  const next = (): void => {
    goNext(form, stepper);
  };
  const back = (): void => {
    stepper.show(Math.max(stepper.current() - 1, 0), true);
  };
  form.querySelectorAll('[data-next]').forEach((button) => {
    button.addEventListener('click', next);
  });
  form.querySelectorAll('[data-back]').forEach((button) => {
    button.addEventListener('click', back);
  });
  return next;
}
