import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCustomerEmail, whatsAppLink } from '../../src/nodes/emails.ts';
import { parseLead, type Lead } from '../../src/nodes/lead.ts';

describe('whatsAppLink', () => {
  it('adds 57 to a 10-digit mobile starting with 3 and keeps every other number as is', () => {
    expect(whatsAppLink('3001234567')).toBe('https://wa.me/573001234567');
    expect(whatsAppLink('570000000001')).toBe('https://wa.me/570000000001');
    expect(whatsAppLink('6051234567')).toBe('https://wa.me/6051234567');
    expect(whatsAppLink('15551234567')).toBe('https://wa.me/15551234567');
  });
});

describe('the customer email status link', () => {
  const parsed = parseLead(JSON.parse(readFileSync('tests/fixtures/lead-payload.json', 'utf8')));
  if (!parsed) throw new Error('the lead payload fixture must parse');
  const lead: Lead = parsed;

  it('adds the status link to the customer email only when present', () => {
    const link = '<a href="https://example.com/my-move/?lead=6f1c2a9e-3b4d-4e8f-9a1b-2c3d4e5f6a7b&amp;token=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef">See your request and confirm your date</a>';
    expect(buildCustomerEmail(lead).html).toContain(link);
    expect(buildCustomerEmail({ ...lead, status_url: '' }).html).not.toContain('confirm your date');
    expect(buildCustomerEmail({ ...lead, locale: 'es' }).html).toContain('>Vea su solicitud y confirme la fecha</a>');
  });

  it('escapes the link inside the attribute', () => {
    const html = buildCustomerEmail({ ...lead, status_url: "https://example.com/?a=1&b='2'" }).html;
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&#39;2&#39;"');
  });
});
