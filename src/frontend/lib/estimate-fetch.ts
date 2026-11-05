import { postJson } from './api.ts';
import type { ApiResult } from './api.ts';
import { estimateDisplayText, estimateOutcome } from './estimate-display.ts';
import type { EstimateOutcome } from './estimate-display.ts';
import type { EstimateRequest } from './form-state.ts';
import { latestOnly } from './latest.ts';

/**
 * Only the network call is wrapped in `latestOnly`, never the `onDisplay` write: `latestOnly`
 * discards a superseded call's return value, not its side effects. Writing only when the result
 * `!== undefined` keeps a stale response from overwriting a newer one.
 */
export function createEstimateFetcher(
  estimateUrl: string,
  onDisplay: (text: string, outcome: EstimateOutcome) => void,
): (request: EstimateRequest) => Promise<void> {
  const fetchLatest = latestOnly((request: EstimateRequest): Promise<ApiResult> => postJson(estimateUrl, request));

  return async (request: EstimateRequest): Promise<void> => {
    const result = await fetchLatest(request);
    if (result === undefined) return;
    onDisplay(estimateDisplayText(result), estimateOutcome(result));
  };
}
