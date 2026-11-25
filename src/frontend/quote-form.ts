import { thankYouHref } from './lib/reference.ts';
import { uuidV4 } from './lib/uuid.ts';
import { createErrorView } from './form/error-view.ts';
import { createEstimatePanel, watchEstimates } from './form/estimate-panel.ts';
import { createStepper, wireStepButtons } from './form/stepper.ts';
import { showInlineSuccess, submitLead } from './form/submit.ts';
import { readConfig } from './form/values.ts';

/** Wires the form's modules together; each one finds its own hooks in the markup. */
function initQuoteForm(form: HTMLFormElement): void {
  const config = readConfig(form);
  const submissionId = uuidV4(); // one per page load, reused on every retry
  const stepper = createStepper(form);
  const errors = createErrorView(form);
  watchEstimates(form, config.estimateUrl, createEstimatePanel(form));
  const next = wireStepButtons(form, stepper);

  const onSuccess = (reference: string | null): void => {
    if (config.thankYouUrl) window.location.assign(thankYouHref(config.thankYouUrl, reference, window.location.href));
    else showInlineSuccess(form, reference);
  };

  // Enter submits implicitly; before the last step it means "Next", not a premature submit.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (stepper.current() < stepper.count - 1) next();
    else void submitLead({ form, config, submissionId, stepper, errors, onSuccess });
  });

  stepper.show(0, false);
}

document.querySelectorAll<HTMLFormElement>('form[data-moving-quote]').forEach(initQuoteForm);
