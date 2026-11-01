/** Polls `${baseUrl}/healthz` once a second until it responds OK or `budgetMs` elapses, with a 5 s timeout per request. */
export async function waitForHealthy(baseUrl: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
    } catch {
      // not up yet; retry below until the budget runs out
    }
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * Polls `${baseUrl}/webhook/${webhookPath}` once a second until it answers 401 (live and
 * JWT-protected) or `budgetMs` elapses, with a 5 s timeout per request. A POST with no
 * `Authorization` header is exactly what the Webhook node's own JWT check rejects first, before
 * any workflow code runs, so 401 is the cheapest possible proof the publish actually took effect.
 */
export async function waitForWebhookAuthProtected(baseUrl: string, webhookPath: string, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/webhook/${webhookPath}`, { method: 'POST', signal: AbortSignal.timeout(5000) });
      if (res.status === 401) return true;
    } catch {
      // not up yet; retry below until the budget runs out
    }
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  }
}
