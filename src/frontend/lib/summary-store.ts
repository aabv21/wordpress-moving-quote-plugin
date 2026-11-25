/**
 * What the thank-you page shows of the request: written by the form just before it redirects,
 * read back only for the same reference. It lives in the visitor's own session storage, so the
 * page never looks a lead up by its reference and can't probe which leads exist.
 */
export const SUMMARY_KEY = 'moving-quote:summary';

export interface ThanksSummary {
  reference: string;
  route: string;
  date: string;
  estimate: string;
}

const FIELDS = ['reference', 'route', 'date', 'estimate'] as const;

/** The session storage, or null where reading it throws (storage blocked by the browser). */
export function sessionStore(): Storage | null {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

/** A storage that throws (private mode, a full quota) just loses the summary. */
export function saveSummary(storage: Pick<Storage, 'setItem'>, summary: ThanksSummary): void {
  try {
    storage.setItem(SUMMARY_KEY, JSON.stringify(summary));
  } catch {
    // The thank-you page then shows the reference alone.
  }
}

/** Null unless the stored JSON parses, every field is a string, and the reference matches. */
export function readSummary(storage: Pick<Storage, 'getItem'>, reference: string): ThanksSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(SUMMARY_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (!FIELDS.every((field) => typeof record[field] === 'string')) return null;
  const summary = record as unknown as ThanksSummary;
  return summary.reference === reference ? { reference: summary.reference, route: summary.route, date: summary.date, estimate: summary.estimate } : null;
}
