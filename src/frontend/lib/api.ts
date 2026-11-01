/** A successful REST call: any 2xx status, with the parsed JSON body. */
export interface ApiSuccess {
  ok: true;
  status: number;
  data: unknown;
}

/**
 * A failed REST call: a non-2xx status, or one that never reached the server at all. `status` is
 * `0` for a network failure. `code` is the WP_Error code when the server sent one JSON-decodable
 * error body, `network_error` when `fetch` itself rejected, and `http_error` for any other
 * non-2xx response (a non-JSON body, or JSON without a `code`).
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

/**
 * POSTs `body` as JSON to `url`, reading the response as the REST contract's WP_Error shape on
 * failure. `fetchImpl` defaults to the global `fetch`; tests pass a stub instead.
 */
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
