import { describe, expect, it } from 'vitest';
import { uuidV4 } from '../../src/frontend/lib/uuid.ts';

describe('uuidV4', () => {
  it('builds a v4 UUID from the bytes a fill function provides', () => {
    const fill = (bytes: Uint8Array): Uint8Array => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = i;
      return bytes;
    };
    expect(uuidV4(fill)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
  });

  it('defaults to crypto.getRandomValues and produces a well-formed v4 UUID', () => {
    expect(uuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
