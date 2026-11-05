/**
 * A call superseded before it settles resolves `undefined`, so a slow response for stale input
 * never overwrites a newer one.
 */
export function latestOnly<A extends unknown[], T>(fn: (...args: A) => Promise<T>): (...args: A) => Promise<T | undefined> {
  let latestCallId = 0;

  return async (...args: A): Promise<T | undefined> => {
    const callId = ++latestCallId;
    const result = await fn(...args);
    return callId === latestCallId ? result : undefined;
  };
}
