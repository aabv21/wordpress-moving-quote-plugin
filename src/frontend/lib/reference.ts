/** The query argument the thank-you page's `[moving_quote_reference]` shortcode reads (`Frontend\ReferenceShortcode::QUERY_ARG`). */
export const REFERENCE_QUERY_ARG = 'reference';

/** The exact shape `Leads\LeadRecord::reference_for()` builds: `MQ-` and 8 uppercase hex digits. */
const REFERENCE_PATTERN = /^MQ-[0-9A-F]{8}$/;

/**
 * The lead's `MQ-…` reference from a successful submission's response body, or null when the body
 * has none (a filled honeypot is answered `{"ok":true}` alone) or anything other than that exact
 * shape, so nothing unexpected is ever shown to the visitor or put into a URL.
 */
export function leadReference(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const reference = (data as { reference?: unknown }).reference;
  return typeof reference === 'string' && REFERENCE_PATTERN.test(reference) ? reference : null;
}

/**
 * The thank-you page URL to redirect to after a successful submission: `thankYouUrl` with the
 * lead's reference set as its `reference` query argument, keeping any query the URL already has,
 * or `thankYouUrl` unchanged when there is no reference to pass. `base` resolves a relative URL.
 */
export function thankYouHref(thankYouUrl: string, reference: string | null, base?: string): string {
  if (reference === null) return thankYouUrl;
  const url = new URL(thankYouUrl, base);
  url.searchParams.set(REFERENCE_QUERY_ARG, reference);
  return url.toString();
}
