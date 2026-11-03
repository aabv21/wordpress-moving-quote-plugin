import { describe, expect, it } from 'vitest';
import { leadReference, REFERENCE_QUERY_ARG, thankYouHref } from '../../src/frontend/lib/reference.ts';

describe('leadReference', () => {
  it('returns the reference from a new or duplicate lead response', () => {
    expect(leadReference({ ok: true, reference: 'MQ-0123ABCD', estimate: {} })).toBe('MQ-0123ABCD');
  });

  it.each<[string, unknown]>([
    ['a filled honeypot, answered without a reference', { ok: true }],
    ['a null body', null],
    ['a non-object body', 'MQ-0123ABCD'],
    ['a non-string reference', { reference: 123 }],
    ['lowercase hex', { reference: 'MQ-0123abcd' }],
    ['the wrong length', { reference: 'MQ-0123ABC' }],
    ['markup', { reference: 'MQ-<b>1234</b>' }],
  ])('is null for %s', (_label, data) => {
    expect(leadReference(data)).toBeNull();
  });
});

describe('thankYouHref', () => {
  it('adds the reference as the query argument the thank-you shortcode reads', () => {
    expect(REFERENCE_QUERY_ARG).toBe('reference');
    expect(thankYouHref('https://example.com/thank-you/', 'MQ-0123ABCD')).toBe('https://example.com/thank-you/?reference=MQ-0123ABCD');
  });

  it('keeps a query the URL already has', () => {
    expect(thankYouHref('https://example.com/?page_id=7', 'MQ-0123ABCD')).toBe('https://example.com/?page_id=7&reference=MQ-0123ABCD');
  });

  it('returns the URL unchanged when there is no reference', () => {
    expect(thankYouHref('https://example.com/thank-you/', null)).toBe('https://example.com/thank-you/');
  });

  it('resolves a relative URL against the base', () => {
    expect(thankYouHref('/thank-you/', 'MQ-0123ABCD', 'https://example.com/get-a-quote/')).toBe('https://example.com/thank-you/?reference=MQ-0123ABCD');
  });
});
