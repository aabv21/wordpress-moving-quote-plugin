/**
 * Zero matches retries; more than one throws at once, since waiting can't resolve ambiguity.
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
