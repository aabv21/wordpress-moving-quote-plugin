// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const FIXTURE = readFileSync('tests/dom/fixtures/quote-form.html', 'utf8');
const ESTIMATE_URL = 'https://example.com/wp-json/moving-quote/v1/estimate?locale=en_US';
const LEADS_URL = 'https://example.com/wp-json/moving-quote/v1/leads?locale=en_US';
const ESTIMATE = { amount: 1130000, low: 1017000, high: 1243000, distance_km: 120, currency: 'COP', display: 'COP 1,017,000 – 1,243,000' };
const STRINGS = {
  sending: 'Sending…',
  networkError: 'Something went wrong. Please check your connection and try again.',
  rateLimited: 'Too many requests. Please try again later.',
  sessionExpired: 'Your session expired. Reload the page and try again.',
  genericError: 'Please fix the highlighted fields.',
};

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function form(): HTMLFormElement {
  const found = document.querySelector<HTMLFormElement>('form[data-moving-quote]');
  if (!found) throw new Error('fixture form missing');
  return found;
}

function q(selector: string): HTMLElement {
  const found = form().querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`${selector} missing`);
  return found;
}

function field(name: string): HTMLInputElement | HTMLSelectElement {
  const found = form().querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!found) throw new Error(`field ${name} missing`);
  return found;
}

function step(index: number): HTMLFieldSetElement {
  const found = form().querySelector<HTMLFieldSetElement>(`fieldset[data-step="${String(index)}"]`);
  if (!found) throw new Error(`step ${String(index)} missing`);
  return found;
}

function visibleStep(): number {
  return [0, 1, 2].filter((index) => !step(index).hidden)[0] ?? -1;
}

/** Sets a value without an event, so no estimate is scheduled. */
function setQuietly(name: string, value: string): void {
  field(name).value = value;
}

function change(name: string, value: string): void {
  const control = field(name);
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillStepOne(): void {
  setQuietly('move_type', 'apartment');
  setQuietly('rooms', '2');
  setQuietly('origin', 'Barranquilla');
  setQuietly('destination', 'Cartagena');
  setQuietly('move_date', '2026-12-01');
}

function fillStepThree(): void {
  setQuietly('name', 'Ana Ruiz');
  setQuietly('phone', '570000000001');
  setQuietly('email', 'ana@example.com');
  const consent = field('consent');
  if (consent instanceof HTMLInputElement) consent.checked = true;
}

function clickNext(): void {
  step(visibleStep()).querySelector<HTMLButtonElement>('[data-next]')?.click();
}

function goToLastStep(): void {
  fillStepOne();
  clickNext();
  clickNext();
  fillStepThree();
}

function submitButton(): HTMLButtonElement {
  const found = form().querySelector<HTMLButtonElement>('[data-submit]');
  if (!found) throw new Error('[data-submit] missing');
  return found;
}

function leadCalls(fetchMock: FetchMock): RequestInit[] {
  return fetchMock.mock.calls.filter(([url]) => url === LEADS_URL).map(([, init]) => init ?? {});
}

function estimateCalls(fetchMock: FetchMock): number {
  return fetchMock.mock.calls.filter(([url]) => url === ESTIMATE_URL).length;
}

/** Lets postJson() read the response body and the handler write the result. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

let fetchMock: FetchMock;
let assign: Mock<(url: string | URL) => void>;

async function mount(options: { thankYouUrl?: string | null; respond?: (url: string) => Promise<Response> } = {}): Promise<void> {
  document.body.innerHTML = FIXTURE;
  if (options.thankYouUrl !== undefined) {
    const config = JSON.parse(form().dataset['config'] ?? '{}') as Record<string, unknown>;
    form().dataset['config'] = JSON.stringify({ ...config, thankYouUrl: options.thankYouUrl });
  }
  const respond = options.respond ?? ((url: string) => Promise.resolve(url === ESTIMATE_URL ? json(200, ESTIMATE) : json(201, { ok: true, reference: 'MQ-1A2B3C4D' })));
  fetchMock = vi.fn((url: string) => respond(url));
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  await import('../../src/frontend/quote-form.ts');
}

beforeEach(() => {
  vi.useFakeTimers();
  assign = vi.fn();
  vi.spyOn(window.location, 'assign').mockImplementation(assign);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('the quote form in a DOM', () => {
  it('starts on step 1 with aria-current on its marker and steps 2 and 3 hidden', async () => {
    await mount();
    expect(step(0).hidden).toBe(false);
    expect(step(1).hidden).toBe(true);
    expect(step(2).hidden).toBe(true);
    const markers = Array.from(form().querySelectorAll('[data-progress-step]'));
    expect(markers.map((item) => item.getAttribute('aria-current'))).toEqual(['step', null, null]);
  });

  it('Next with step 1 filled shows step 2 and focuses its legend', async () => {
    await mount();
    fillStepOne();
    clickNext();
    expect(visibleStep()).toBe(1);
    expect(document.activeElement).toBe(step(1).querySelector('legend'));
    const markers = Array.from(form().querySelectorAll('[data-progress-step]'));
    expect(markers.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'step', null]);
  });

  it('Next with a required field empty stays on step 1', async () => {
    await mount();
    fillStepOne();
    setQuietly('origin', '');
    clickNext();
    expect(visibleStep()).toBe(0);
  });

  it('Enter before the last step means Next and posts nothing to leadsUrl', async () => {
    await mount();
    fillStepOne();
    form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(visibleStep()).toBe(1);
    expect(leadCalls(fetchMock)).toHaveLength(0);
  });

  it('three quick step-1 changes make one estimate call after 300 ms and show its display text', async () => {
    await mount();
    setQuietly('move_type', 'apartment');
    change('rooms', '2');
    change('origin', 'Barranquilla');
    change('destination', 'Cartagena');
    await vi.advanceTimersByTimeAsync(299);
    expect(estimateCalls(fetchMock)).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(estimateCalls(fetchMock)).toBe(1);
    expect(q('.moving-quote__estimate').dataset['estimateState']).toBe('ready');
    expect(q('[data-estimate-value]').textContent).toBe('COP 1,017,000 – 1,243,000');
    expect(q('[data-estimate-hint]').hidden).toBe(true);
  });

  it('typing in name, phone or email schedules no estimate call', async () => {
    await mount();
    fillStepOne();
    for (const name of ['name', 'phone', 'email']) {
      field(name).value = 'x';
      field(name).dispatchEvent(new Event('input', { bubbles: true }));
    }
    await vi.advanceTimersByTimeAsync(1000);
    expect(estimateCalls(fetchMock)).toBe(0);
  });

  it('a failed estimate shows the dash and the estimate error', async () => {
    await mount({ respond: () => Promise.resolve(json(500, { code: 'internal_server_error' })) });
    fillStepOne();
    change('destination', 'Cartagena');
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(q('.moving-quote__estimate').dataset['estimateState']).toBe('error');
    expect(q('[data-estimate-value]').textContent).toBe('—');
    expect(q('[data-estimate-error]').hidden).toBe(false);
  });

  it('submit disables the button and shows Sending…, and a second click sends nothing', async () => {
    await mount({ respond: (url) => (url === LEADS_URL ? new Promise<Response>(() => undefined) : Promise.resolve(json(200, ESTIMATE))) });
    goToLastStep();
    submitButton().click();
    await settle();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe(STRINGS.sending);
    submitButton().click();
    await settle();
    expect(leadCalls(fetchMock)).toHaveLength(1);
    const [init] = leadCalls(fetchMock);
    expect(new Headers(init?.headers).get('X-WP-Nonce')).toBe('test-nonce');
  });

  it('a 201 redirects to the thank-you URL with ?reference=', async () => {
    await mount();
    goToLastStep();
    submitButton().click();
    await settle();
    expect(assign).toHaveBeenCalledWith('https://example.com/thank-you/?reference=MQ-1A2B3C4D');
  });

  it('with no thank-you page, a 201 shows the inline success with the reference and focuses it', async () => {
    await mount({ thankYouUrl: null });
    goToLastStep();
    submitButton().click();
    await settle();
    const success = q('[data-success]');
    expect(assign).not.toHaveBeenCalled();
    expect(success.hidden).toBe(false);
    expect(q('[data-success-reference]').hidden).toBe(false);
    expect(q('[data-success-reference-value]').textContent).toBe('MQ-1A2B3C4D');
    expect(document.activeElement).toBe(success);
    expect(step(2).hidden).toBe(true);
  });

  it('a 422 returns to the first step with an error, marks the field invalid and focuses it', async () => {
    await mount({
      respond: (url) =>
        Promise.resolve(url === LEADS_URL ? json(422, { code: 'moving_quote_invalid', data: { errors: { origin: 'Choose a city from the list.' } } }) : json(200, ESTIMATE)),
    });
    goToLastStep();
    submitButton().click();
    await settle();
    expect(visibleStep()).toBe(0);
    expect(q('[data-form-error]').textContent).toBe(STRINGS.genericError);
    expect(q('[data-error-for="origin"]').textContent).toBe('Choose a city from the list.');
    expect(field('origin').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field('origin'));
    expect(submitButton().disabled).toBe(false);
  });

  it.each([
    ['a 403', () => Promise.resolve(json(403, { code: 'rest_cookie_invalid_nonce' })), STRINGS.sessionExpired],
    ['a 429', () => Promise.resolve(json(429, { code: 'moving_quote_rate_limited' })), STRINGS.rateLimited],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch')), STRINGS.networkError],
  ] as const)('%s shows its message and re-enables the button', async (_, leadResponse, message) => {
    await mount({ respond: (url) => (url === LEADS_URL ? leadResponse() : Promise.resolve(json(200, ESTIMATE))) });
    goToLastStep();
    submitButton().click();
    await settle();
    expect(q('[data-form-error]').textContent).toBe(message);
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().textContent).toBe('Send my request');
    expect(assign).not.toHaveBeenCalled();
  });

  it('a retry after a 429 reuses the same submission_id', async () => {
    let leadPosts = 0;
    await mount({
      respond: (url) => {
        if (url !== LEADS_URL) return Promise.resolve(json(200, ESTIMATE));
        leadPosts += 1;
        return Promise.resolve(leadPosts === 1 ? json(429, { code: 'moving_quote_rate_limited' }) : json(201, { ok: true, reference: 'MQ-1A2B3C4D' }));
      },
    });
    goToLastStep();
    submitButton().click();
    await settle();
    submitButton().click();
    await settle();
    const ids = leadCalls(fetchMock).map((init) => (JSON.parse(init.body as string) as { submission_id: string }).submission_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ids[1]).toBe(ids[0]);
  });
});
