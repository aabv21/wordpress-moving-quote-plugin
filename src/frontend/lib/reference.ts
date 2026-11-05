/** Must match `Frontend\ReferenceShortcode::QUERY_ARG`. */
export const REFERENCE_QUERY_ARG = 'reference';

/** The exact shape `Leads\LeadRecord::reference_for()` builds. */
const REFERENCE_PATTERN = /^MQ-[0-9A-F]{8}$/;

/**
 * Null for anything but that exact shape (a filled honeypot gets `{"ok":true}` alone), so nothing
 * unexpected reaches the page or a URL.
 */
export function leadReference(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const reference = (data as { reference?: unknown }).reference;
  return typeof reference === 'string' && REFERENCE_PATTERN.test(reference) ? reference : null;
}

/** Keeps any existing query. `base` resolves a relative URL. */
export function thankYouHref(thankYouUrl: string, reference: string | null, base?: string): string {
  if (reference === null) return thankYouUrl;
  const url = new URL(thankYouUrl, base);
  url.searchParams.set(REFERENCE_QUERY_ARG, reference);
  return url.toString();
}
