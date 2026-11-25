import type { EstimateOutcome } from '../lib/estimate-display.ts';

/** The `data-config` payload, built by `Frontend\Shortcode::config()`. */
export interface QuoteFormConfig {
  estimateUrl: string;
  leadsUrl: string;
  nonce: string;
  thankYouUrl: string | null;
  strings: {
    sending: string;
    networkError: string;
    serverError: string;
    rateLimited: string;
    sessionExpired: string;
    genericError: string;
  };
}

export type EstimateState = 'idle' | 'loading' | EstimateOutcome;

export interface Stepper {
  readonly count: number;
  current: () => number;
  /** Shows one step; focusing its legend tells a screen reader the step changed. */
  show: (step: number, focusLegend: boolean) => void;
  fieldset: (step: number) => HTMLFieldSetElement | undefined;
}

export interface EstimatePanel {
  setState: (state: EstimateState) => void;
  show: (text: string, outcome: EstimateOutcome) => void;
}

export interface ErrorView {
  setField: (field: string, message: string | undefined) => void;
  clearAll: () => void;
  setForm: (message: string) => void;
  focusFirstInvalid: (fieldset: HTMLFieldSetElement | undefined) => void;
}
