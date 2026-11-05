export interface ApiSuccess {
  ok: true;
  status: number;
  data: unknown;
}

/**
 * `status` is `0` for a network failure. `code` is the WP_Error code when the body carries one,
 * `network_error` when `fetch` rejected, and `http_error` otherwise.
 */
export interface ApiFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  fieldErrors: Record<string, string>;
}

export type ApiResult = ApiSuccess | ApiFailure;

interface WpErrorBody {
  code?: unknown;
  message?: unknown;
  data?: { errors?: unknown };
}

function isFieldErrors(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every((entry) => typeof entry === 'string');
}

/** Never rejects: every network or HTTP failure comes back as a result. */
export async function postJson(url: string, body: unknown, headers?: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, code: 'network_error', message: 'network_error', fieldErrors: {} };
  }

  if (response.ok) {
    const data: unknown = await response.json().catch(() => null);
    return { ok: true, status: response.status, data };
  }

  const parsed: unknown = await response.json().catch(() => null);
  if (parsed === null || typeof parsed !== 'object') {
    return { ok: false, status: response.status, code: 'http_error', message: 'http_error', fieldErrors: {} };
  }

  const errorBody = parsed as WpErrorBody;
  const code = typeof errorBody.code === 'string' ? errorBody.code : 'http_error';
  const message = typeof errorBody.message === 'string' ? errorBody.message : 'http_error';
  const fieldErrors = isFieldErrors(errorBody.data?.errors) ? errorBody.data.errors : {};

  return { ok: false, status: response.status, code, message, fieldErrors };
}
