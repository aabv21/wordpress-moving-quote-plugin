import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/nodes/verify-request.ts';

const body = readFileSync('tests/fixtures/lead-payload.json', 'utf8').trim();
const parseBody = (text: string): Record<string, unknown> & { request_uuid: string; move: Record<string, unknown> } =>
  JSON.parse(text) as Record<string, unknown> & { request_uuid: string; move: Record<string, unknown> };
const parsed = parseBody(body);
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const now = 1_793_800_800;
const claims = { jti: parsed.request_uuid, iat: now - 10, exp: now + 290, body_sha256: sha(body) };
const input = (over: Record<string, unknown> = {}) => ({ body: parseBody(body) as unknown, body_sha256: sha(body), jwtPayload: { ...claims, ...over } });

describe('verify-request', () => {
  it('accepts a fresh token bound to this body', () => {
    expect(run(input(), now)).toEqual({ ok: true, lead: parseBody(body) });
  });
  it.each([
    ['missing exp', { exp: undefined }, 'missing_claims'],
    ['lifetime over five minutes', { exp: now + 291 }, 'token_lifetime'],
    ['issued beyond the clock skew', { iat: now + 61, exp: now + 300 }, 'token_not_yet_valid'],
    ['expired', { iat: now - 400, exp: now - 100 }, 'token_expired'],
    ['hash of another body', { body_sha256: sha('{}') }, 'body_hash_mismatch'],
    ['jti of another request', { jti: '00000000-0000-4000-8000-000000000000' }, 'jti_mismatch'],
  ])('rejects %s', (_label, over, reason) => {
    expect(run(input(over), now)).toEqual({ ok: false, status: 401, reason });
  });
  it('allows sixty seconds of clock skew', () => {
    expect(run(input({ iat: now + 60, exp: now + 300 }), now).ok).toBe(true);
  });
  it('rejects a payload outside the contract with 422', () => {
    const bad = JSON.stringify({ ...parsed, move: { ...parsed.move, rooms: 9 } });
    expect(run({ body: JSON.parse(bad) as unknown, body_sha256: sha(bad), jwtPayload: { ...claims, body_sha256: sha(bad) } }, now))
      .toEqual({ ok: false, status: 422, reason: 'invalid_payload' });
  });
});
