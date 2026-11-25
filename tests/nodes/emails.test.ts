import { describe, expect, it } from 'vitest';
import { whatsAppLink } from '../../src/nodes/emails.ts';

describe('whatsAppLink', () => {
  it('adds 57 to a 10-digit mobile starting with 3 and keeps every other number as is', () => {
    expect(whatsAppLink('3001234567')).toBe('https://wa.me/573001234567');
    expect(whatsAppLink('570000000001')).toBe('https://wa.me/570000000001');
    expect(whatsAppLink('6051234567')).toBe('https://wa.me/6051234567');
    expect(whatsAppLink('15551234567')).toBe('https://wa.me/15551234567');
  });
});
