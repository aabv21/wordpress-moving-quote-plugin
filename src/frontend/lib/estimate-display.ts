import type { ApiResult } from './api.ts';

/** Shown while no estimate has loaded yet, and again after a failed estimate request. */
export const ESTIMATE_PLACEHOLDER = '—';

/**
 * The placeholder on any failure, never the previous estimate, which would read as current for a
 * route the server just rejected.
 */
export function estimateDisplayText(result: ApiResult): string {
  return displayString(result) ?? ESTIMATE_PLACEHOLDER;
}

export type EstimateOutcome = 'ready' | 'error';

/**
 * `ready` exactly when `estimateDisplayText()` shows a range, so the panel never shows a price and
 * the error together, or neither.
 */
export function estimateOutcome(result: ApiResult): EstimateOutcome {
  return displayString(result) === null ? 'error' : 'ready';
}

function displayString(result: ApiResult): string | null {
  if (!result.ok) return null;
  const data = result.data as { display?: unknown } | null;
  return typeof data?.display === 'string' ? data.display : null;
}

const NON_PRICING_FIELDS = new Set(['name', 'phone', 'email']);

/**
 * False for name, phone, and email: they never affect price, and refetching on each keystroke
 * would spend the estimate rate limit.
 */
export function affectsEstimate(fieldName: string): boolean {
  return !NON_PRICING_FIELDS.has(fieldName);
}
