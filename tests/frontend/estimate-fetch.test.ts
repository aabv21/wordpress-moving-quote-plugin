import { describe, expect, it, vi } from 'vitest';
import { createEstimateFetcher } from '../../src/frontend/lib/estimate-fetch.ts';
import type { EstimateRequest } from '../../src/frontend/lib/form-state.ts';

const REQUEST: EstimateRequest = { move_type: 'apartment', rooms: 2, origin: 'Barranquilla', destination: 'Cartagena', extras: [] };

describe('createEstimateFetcher', () => {
  it('a stale response never overwrites a newer one already displayed', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const displayed: string[] = [];
    const fetchEstimate = createEstimateFetcher('https://example.com/estimate', (text) => {
      displayed.push(text);
    });

    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    fetchMock.mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));

    const firstCall = fetchEstimate(REQUEST);
    const secondCall = fetchEstimate(REQUEST);

    // The newer (second) call's response arrives first; the older (first) call's response
    // arrives after it — the exact ordering a slow network response for stale input produces.
    resolveSecond(new Response(JSON.stringify({ display: 'COP 2,000,000 – 2,400,000' }), { status: 200 }));
    await secondCall;
    resolveFirst(new Response(JSON.stringify({ display: 'COP 1,000,000 – 1,200,000' }), { status: 200 }));
    await firstCall;

    // Only the newer call's text was ever written: the stale response resolved after it, but
    // caused no write at all, so the displayed estimate never regresses to the older value.
    expect(displayed).toEqual(['COP 2,000,000 – 2,400,000']);
  });

  it('reports a failed estimate as an error with the placeholder text', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'moving_quote_rate_limited' }), { status: 429 })));
    const displayed: [string, string][] = [];
    const fetchEstimate = createEstimateFetcher('https://example.com/estimate', (text, outcome) => {
      displayed.push([text, outcome]);
    });

    await fetchEstimate(REQUEST);

    expect(displayed).toEqual([['—', 'error']]);
  });

  it('writes the latest call’s own result when calls resolve in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ display: 'COP 1,000,000 – 1,200,000' }), { status: 200 })),
    );
    const displayed: [string, string][] = [];
    const fetchEstimate = createEstimateFetcher('https://example.com/estimate', (text, outcome) => {
      displayed.push([text, outcome]);
    });

    await fetchEstimate(REQUEST);

    expect(displayed).toEqual([['COP 1,000,000 – 1,200,000', 'ready']]);
  });
});
