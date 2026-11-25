// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const FIXTURE = readFileSync('tests/dom/fixtures/thank-you.html', 'utf8');
const SUMMARY = { reference: 'MQ-1A2B3C4D', route: 'Barranquilla → Cartagena', date: '2026-12-01', estimate: 'COP 1,017,000 – 1,243,000' };

function q(selector: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`${selector} missing`);
  return found;
}

async function mount(storedReference: string, overrides: Partial<typeof SUMMARY> = {}): Promise<void> {
  document.body.innerHTML = FIXTURE;
  window.history.replaceState({}, '', '/thank-you/?reference=MQ-1A2B3C4D');
  sessionStorage.setItem('moving-quote:summary', JSON.stringify({ ...SUMMARY, ...overrides, reference: storedReference }));
  vi.resetModules();
  await import('../../src/frontend/thank-you.ts');
}

afterEach(() => {
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('the thank-you card', () => {
  it('fills the summary only when the stored reference matches the page’s', async () => {
    await mount('MQ-1A2B3C4D');
    expect(q('[data-thanks-summary]').hidden).toBe(false);
    expect(q('[data-thanks-route]').textContent).toBe('Barranquilla → Cartagena');
    expect(q('[data-thanks-date]').textContent).toBe('2026-12-01');
    expect(q('[data-thanks-estimate]').textContent).toBe('COP 1,017,000 – 1,243,000');

    await mount('MQ-00000000');
    expect(q('[data-thanks-summary]').hidden).toBe(true);
    expect(q('[data-thanks-route]').textContent).toBe('');
  });

  it('renders markup stored in the summary as text, never as HTML', async () => {
    const route = '<img src=x onerror=alert(1)>';
    await mount('MQ-1A2B3C4D', { route });
    expect(document.querySelector('[data-thanks-route] img')).toBeNull();
    expect(q('[data-thanks-route]').textContent).toBe(route);
  });
});
