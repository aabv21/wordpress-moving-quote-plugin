import { parseLead, type Lead } from './lead.ts';

/** The JWT's own lifetime cap and the clock skew n8n allows. */
export const MAX_LIFETIME_SECONDS = 300;
export const CLOCK_SKEW_SECONDS = 60;

type Rejection = { ok: false; status: 401 | 422; reason: string };

interface Claims {
  iat: number;
  exp: number;
  jti: string;
  body_sha256: string;
}

function rejected(status: 401 | 422, reason: string): Rejection {
  return { ok: false, status, reason };
}

/** n8n's JWT check doesn't enforce these four claims' shape. */
function parseClaims(jwtPayload: unknown): Claims | null {
  if (typeof jwtPayload !== 'object' || jwtPayload === null) return null;
  const { iat, exp, jti, body_sha256: bodySha256 } = jwtPayload as Record<string, unknown>;
  if (typeof iat !== 'number' || !Number.isInteger(iat)) return null;
  if (typeof exp !== 'number' || !Number.isInteger(exp)) return null;
  if (typeof jti !== 'string') return null;
  if (typeof bodySha256 !== 'string') return null;
  return { iat, exp, jti, body_sha256: bodySha256 };
}

/**
 * What the Webhook's `jwtAuth` doesn't check, in order: lifetime, skew, body binding, the
 * contract, and `jti` = `request_uuid`. `jwtAuth` verifies `exp` only when present, so a token
 * without one reaches here as `missing_claims`.
 */
export function run(
  input: { body: unknown; jwtPayload?: unknown; body_sha256: string },
  nowSeconds: number = Math.floor(Date.now() / 1000),
): { ok: true; lead: Lead } | { ok: false; status: 401 | 422; reason: string } {
  const claims = parseClaims(input.jwtPayload);
  if (!claims) return rejected(401, 'missing_claims');

  if (claims.exp - claims.iat > MAX_LIFETIME_SECONDS || claims.exp <= claims.iat) return rejected(401, 'token_lifetime');
  if (claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) return rejected(401, 'token_not_yet_valid');
  if (claims.exp <= nowSeconds) return rejected(401, 'token_expired');
  if (claims.body_sha256 !== input.body_sha256) return rejected(401, 'body_hash_mismatch');

  const lead = parseLead(input.body);
  if (!lead) return rejected(422, 'invalid_payload');

  if (claims.jti !== lead.request_uuid) return rejected(401, 'jti_mismatch');

  return { ok: true, lead };
}
