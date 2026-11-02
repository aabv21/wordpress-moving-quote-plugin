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
  if (!result.ok) return ESTIMATE_PLACEHOLDER;
  const data = result.data as { display?: unknown };
  return typeof data.display === 'string' ? data.display : ESTIMATE_PLACEHOLDER;
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
