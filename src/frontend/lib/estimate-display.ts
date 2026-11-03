import type { ApiResult } from './api.ts';

/** Shown while no estimate has loaded yet, and again after a failed estimate request. */
export const ESTIMATE_PLACEHOLDER = '—';

/**
 * The text the estimate display should show for one estimate API result: the server's own
 * `display` string on success, or the placeholder dash on any failure (a missing route, a 429, a
 * network error, …) — never the previous estimate, which would otherwise read as still current
 * for a route or combination the server just rejected.
 */
export function estimateDisplayText(result: ApiResult): string {
  return displayString(result) ?? ESTIMATE_PLACEHOLDER;
}

/** Whether an estimate panel shows a price (`ready`) or its error message (`error`) after a result arrives. */
export type EstimateOutcome = 'ready' | 'error';

/**
 * The panel state for one estimate API result: `ready` exactly when `estimateDisplayText()` shows
 * the server's own range, `error` whenever it falls back to the placeholder — so the panel never
 * shows a price and the error message at once, or neither.
 */
export function estimateOutcome(result: ApiResult): EstimateOutcome {
  return displayString(result) === null ? 'error' : 'ready';
}

/** The server's `display` string from a successful result, or null for a failure or a body without one. */
function displayString(result: ApiResult): string | null {
  if (!result.ok) return null;
  const data = result.data as { display?: unknown } | null;
  return typeof data?.display === 'string' ? data.display : null;
}

/** Field names whose own `input` event must never trigger an estimate refetch: they don't affect price. */
const NON_PRICING_FIELDS = new Set(['name', 'phone', 'email']);

/**
 * True when a change to `fieldName` should trigger an estimate refetch. False for the
 * customer-detail fields (name, phone, email), which the estimate endpoint never reads — typing
 * into them has no effect on the price, so refetching on every keystroke there is only wasted
 * requests against the rate limit a genuine price change might need.
 */
export function affectsEstimate(fieldName: string): boolean {
  return !NON_PRICING_FIELDS.has(fieldName);
}
