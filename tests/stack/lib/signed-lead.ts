import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { signHs256 } from './jwt.ts';
import { required } from './stack.ts';

const FIXTURE = JSON.parse(readFileSync('tests/fixtures/lead-payload.json', 'utf8')) as Record<string, unknown>;
const TOKEN_LIFETIME_SECONDS = 300;

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The lead fixture with a fresh `request_uuid` and its matching reference. */
export function buildSignedLeadBody(overrides: Record<string, unknown> = {}): { text: string; requestUuid: string } {
  const requestUuid = randomUUID();
  const reference = `MQ-${requestUuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const body = { ...FIXTURE, ...overrides, request_uuid: requestUuid, reference };
  return { text: JSON.stringify(body), requestUuid };
}

/** Posts straight to `lead-intake`'s webhook, signed the way WordPress signs it. */
export async function postSignedLead(text: string, requestUuid: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const claims = { jti: requestUuid, iat: now, exp: now + TOKEN_LIFETIME_SECONDS, body_sha256: sha256Hex(text) };
  const token = signHs256(claims, required('LEAD_WEBHOOK_SECRET'));
  const res = await fetch(`${required('N8N_URL')}/webhook/moving-quote/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: text,
  });
  if (res.status !== 200) throw new Error(`lead-intake answered ${String(res.status)}, expected 200`);
}
