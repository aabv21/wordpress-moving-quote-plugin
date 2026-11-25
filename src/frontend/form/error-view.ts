import type { ErrorView } from './types.ts';

export function createErrorView(form: HTMLFormElement): ErrorView {
  const formError = form.querySelector<HTMLElement>('[data-form-error]');

  return {
    setField(field, message) {
      const describedEl = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
      if (!describedEl) return;
      describedEl.textContent = message ?? '';
      const input = form.elements.namedItem(field);
      if (input instanceof HTMLElement) {
        if (message) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
      }
    },
    clearAll() {
      form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => {
        el.textContent = '';
      });
      form.querySelectorAll('[aria-invalid]').forEach((el) => {
        el.removeAttribute('aria-invalid');
      });
      if (formError) formError.textContent = '';
    },
    setForm(message) {
      if (formError) formError.textContent = message;
    },
    /** Falls back to the step's legend when no single control carries the error (e.g. `extras`). */
    focusFirstInvalid(fieldset) {
      const invalid = fieldset?.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (invalid) invalid.focus();
      else fieldset?.querySelector('legend')?.focus();
    },
  };
}
