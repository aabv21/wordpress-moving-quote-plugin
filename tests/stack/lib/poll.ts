/**
 * Polls `lookup` (read-only) until it returns exactly one id, or `deadlineMs` elapses — for a
 * sub-execution row created only after its own parent has already answered the caller, so the row
 * can genuinely not exist yet the instant the caller's own response arrives. Zero matches retries;
 * more than one is a real ambiguity and throws immediately, since no amount of waiting resolves it.
 */
export async function pollForExecutionId(lookup: () => Promise<number[]>, deadlineMs: number, intervalMs = 200): Promise<number> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const ids = await lookup();
    if (ids.length === 1) return ids[0] as number;
    if (ids.length > 1) throw new Error(`expected exactly one execution, found ${String(ids.length)}`);
    if (Date.now() >= deadline) throw new Error(`execution did not appear within ${String(deadlineMs)} ms`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
