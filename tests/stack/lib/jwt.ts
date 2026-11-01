import { createHmac, timingSafeEqual } from 'node:crypto';

function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buffer.toString('base64url');
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

/** Signs `claims` into a compact HS256 JWT, used by tests that need to mint their own tokens. */
export function signHs256(claims: object, secret: string, header: object = { alg: 'HS256', typ: 'JWT' }): string {
  const headerPart = base64UrlEncode(JSON.stringify(header));
  const claimsPart = base64UrlEncode(JSON.stringify(claims));
  const signingInput = `${headerPart}.${claimsPart}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verifies a compact HS256 JWT's signature with a constant-time comparison, decodes its header and
 * claims, and returns both — or null when the token is malformed or the signature doesn't match.
 * Never compares the secret itself: a test asserts the returned value is not null, never that two
 * secrets are equal, so a mismatch never has to be diagnosed by eye against a logged secret.
 */
export function decodeVerified(token: string, secret: string): { header: unknown; claims: unknown } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, claimsPart, signaturePart] = parts as [string, string, string];

  const signingInput = `${headerPart}.${claimsPart}`;
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  const actual = base64UrlDecode(signaturePart);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    return {
      header: JSON.parse(base64UrlDecode(headerPart).toString('utf8')) as unknown,
      claims: JSON.parse(base64UrlDecode(claimsPart).toString('utf8')) as unknown,
    };
  } catch {
    return null;
  }
}
