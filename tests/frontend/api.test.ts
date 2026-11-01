import { describe, expect, it, vi } from 'vitest';
import { postJson } from '../../src/frontend/lib/api.ts';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('postJson', () => {
  it('a 422 WP_Error body gives ok: false with the status, code, and field errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(422, {
        code: 'moving_quote_invalid',
        message: 'Please fix the highlighted fields.',
        data: { errors: { email: 'Please check this value.' } },
      }),
    );

    const result = await postJson('/wp-json/moving-quote/v1/leads', { email: 'x' }, undefined, fetchImpl);

    expect(result).toEqual({
      ok: false,
      status: 422,
      code: 'moving_quote_invalid',
      message: 'Please fix the highlighted fields.',
      fieldErrors: { email: 'Please check this value.' },
    });
  });

  it('a rejected fetch gives status 0 and code network_error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await postJson('/wp-json/moving-quote/v1/leads', {}, undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(0);
      expect(result.code).toBe('network_error');
    }
  });

  it('a 201 gives ok: true with the parsed data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, reference: 'MQ-ABCD1234' }));

    const result = await postJson('/wp-json/moving-quote/v1/leads', {}, undefined, fetchImpl);

    expect(result).toEqual({ ok: true, status: 201, data: { ok: true, reference: 'MQ-ABCD1234' } });
  });

  it('a non-JSON error body gives code http_error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>Internal Server Error</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }));

    const result = await postJson('/wp-json/moving-quote/v1/leads', {}, undefined, fetchImpl);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.code).toBe('http_error');
    }
  });

  it('sends Content-Type: application/json and the given X-WP-Nonce header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { amount: 1 }));

    await postJson('/wp-json/moving-quote/v1/estimate', { rooms: 2 }, { 'X-WP-Nonce': 'abc123' }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/wp-json/moving-quote/v1/estimate');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-WP-Nonce']).toBe('abc123');
    expect(init.body).toBe(JSON.stringify({ rooms: 2 }));
  });

  it('treats a 403 with either nonce code as a failure carrying that code', async () => {
    const pluginCode = await postJson(
      '/wp-json/moving-quote/v1/leads',
      {},
      undefined,
      vi.fn().mockResolvedValue(jsonResponse(403, { code: 'moving_quote_bad_nonce', message: 'Your session expired. Reload the page and try again.' })),
    );
    expect(pluginCode.ok).toBe(false);
    if (!pluginCode.ok) expect(pluginCode.code).toBe('moving_quote_bad_nonce');

    const coreCode = await postJson(
      '/wp-json/moving-quote/v1/leads',
      {},
      undefined,
      vi.fn().mockResolvedValue(jsonResponse(403, { code: 'rest_cookie_invalid_nonce', message: 'Cookie check failed' })),
    );
    expect(coreCode.ok).toBe(false);
    if (!coreCode.ok) expect(coreCode.code).toBe('rest_cookie_invalid_nonce');
  });
});
