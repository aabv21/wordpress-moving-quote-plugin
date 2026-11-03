import { postJson } from './api.ts';
import type { ApiResult } from './api.ts';
import { estimateDisplayText } from './estimate-display.ts';
import type { EstimateRequest } from './form-state.ts';
import { latestOnly } from './latest.ts';

/**
 * Builds one estimate fetcher bound to `estimateUrl` and `onDisplay` (the caller's own write to
 * the DOM, or a test's own spy). Only the network call is wrapped in `latestOnly` — never the
 * write — because `latestOnly` discards a superseded call's *return value*, not any side effect
 * the wrapped function performs itself. Wrapping a function that writes `textContent` internally
 * would still run that write for every call, in whatever order its response arrived, so a slow
 * response for stale input could overwrite a newer result already on screen. Keeping the write
 * out here, called only when the fetch's result `!== undefined`, is what makes a superseded call
 * a true no-op.
 */
export function createEstimateFetcher(estimateUrl: string, onDisplay: (text: string) => void): (request: EstimateRequest) => Promise<void> {
  const fetchLatest = latestOnly((request: EstimateRequest): Promise<ApiResult> => postJson(estimateUrl, request));

  return async (request: EstimateRequest): Promise<void> => {
    const result = await fetchLatest(request);
    if (result === undefined) return;
    onDisplay(estimateDisplayText(result));
  };
}
