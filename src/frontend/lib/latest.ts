/**
 * Wraps an async `fn` so only its most recently started call can resolve a caller-visible value.
 * A call superseded by a newer one before it settles resolves `undefined` instead, so a slow
 * response for stale input (e.g. an earlier keystroke) never overwrites a newer one already
 * rendered on screen.
 */
export function latestOnly<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T | undefined> {
  let latestCallId = 0;

  return async (...args: A): Promise<T | undefined> => {
    const callId = ++latestCallId;
    const result = await fn(...args);
    return callId === latestCallId ? result : undefined;
  };
}
