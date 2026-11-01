import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { disableDelivery, login, required, resetRateLimits, rest, site, wp, wpJson } from '../lib/stack.ts';

const QUOTE_PAGE_PATH = '/get-a-quote/';
const OPTION_NAME = 'moving_quote_settings';
const LEADS_PATH = '/moving-quote/v1/leads';

const STEP_LEGENDS = ['Your move', 'Extra services', 'Your details'];

interface QuoteFormConfig {
  estimateUrl: string;
  leadsUrl: string;
  nonce: string;
  thankYouUrl: string | null;
  strings: Record<string, string>;
}

/** Reverses the HTML entities `esc_attr()` encodes an attribute value with. */
function decodeHtmlEntities(text: string): string {
  return text.replaceAll('&quot;', '"').replaceAll('&#039;', "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

/**
 * Decodes the `data-config` attribute (`esc_attr( wp_json_encode( … ) )`) and parses it as JSON.
 * This repo has no HTML parser dependency, so the attribute itself is pulled out of the raw
 * markup by regex.
 */
function readConfig(html: string): QuoteFormConfig {
  const match = /data-config="([^"]*)"/.exec(html);
  if (!match?.[1]) throw new Error('data-config attribute not found');
  return JSON.parse(decodeHtmlEntities(match[1])) as QuoteFormConfig;
}

const SELECT_PATTERNS = {
  origin: /<select[^>]*\bname="origin"[^>]*>([\s\S]*?)<\/select>/,
  destination: /<select[^>]*\bname="destination"[^>]*>([\s\S]*?)<\/select>/,
} as const;

/** Every value attribute of a select's non-placeholder `<option>`s (the ones with a non-empty `value`). */
function selectOptionValues(html: string, selectName: keyof typeof SELECT_PATTERNS): string[] {
  const select = SELECT_PATTERNS[selectName].exec(html)?.[1];
  if (select === undefined) throw new Error(`select[name=${selectName}] not found`);
  const values: string[] = [];
  for (const optionMatch of select.matchAll(/<option\s+value="([^"]*)"/g)) {
    const value = optionMatch[1];
    if (value !== undefined && '' !== value) values.push(decodeHtmlEntities(value));
  }
  return values;
}

describe('the quote page', () => {
  let adminCookies: string;
  let restoreDelivery: () => Promise<void>;

  // Registered first, so its afterAll (below) is the last one to run (afterAll hooks run in
  // reverse registration order): every other restore in this file must settle before this one
  // puts the real webhook_url back, including the city-name test's own settings restore, whose
  // captured "before" snapshot holds the '' this sets.
  beforeAll(async () => {
    restoreDelivery = await disableDelivery();
  });
  afterAll(async () => {
    await restoreDelivery();
  });

  beforeAll(async () => {
    adminCookies = await login(required('WP_ADMIN_USER'), required('WP_ADMIN_PASSWORD'));
  });

  afterEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    // Every lead this suite inserts is a real delivery attempt once delivery is configured, and
    // cron keeps retrying a pending one for hours; none of them must outlive this file.
    await deleteCreatedLeads();
  });

  it('renders the three-step form with its script and config, for an anonymous visitor', async () => {
    const res = await fetch(site(QUOTE_PAGE_PATH));
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('data-moving-quote');
    for (const legend of STEP_LEGENDS) {
      expect(html).toContain(legend);
    }

    const originOptions = selectOptionValues(html, 'origin');
    const destinationOptions = selectOptionValues(html, 'destination');
    expect(originOptions).toHaveLength(7);
    expect(destinationOptions).toHaveLength(7);

    const honeypot = /<input[^>]*\bname="website"[^>]*>/.exec(html)?.[0];
    expect(honeypot).toBeDefined();
    expect(honeypot).toContain('tabindex="-1"');
    expect(honeypot).toContain('autocomplete="off"');

    expect(html).toMatch(/<script[^>]*\bsrc="[^"]*\/plugins\/moving-quote\/assets\/quote-form\.js[^"]*"/);

    const config = readConfig(html);
    expect(typeof config.nonce).toBe('string');
    expect(config.nonce.length).toBeGreaterThan(0);
    expect(config.estimateUrl).toMatch(/\/wp-json\/moving-quote\/v1\/estimate$/);
    expect(config.leadsUrl).toMatch(/\/wp-json\/moving-quote\/v1\/leads$/);
    expect(config.thankYouUrl).toMatch(/\/thank-you\/$/);
  });

  it('does not load the quote-form script on a page without the shortcode', async () => {
    const res = await fetch(site('/'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('quote-form.js');
  });

  it('accepts an anonymous submission signed with the page’s own nonce', async () => {
    const page = await fetch(site(QUOTE_PAGE_PATH));
    const config = readConfig(await page.text());

    const res = await rest(LEADS_PATH, validLead(), { nonce: config.nonce });
    expect(res.status).toBe(201);
  });

  it('a logged-in admin can submit with their own nonce, but not without one', async () => {
    const page = await fetch(site(QUOTE_PAGE_PATH), { headers: { Cookie: adminCookies } });
    expect(page.status).toBe(200);
    const config = readConfig(await page.text());

    const withNonce = await rest(LEADS_PATH, validLead(), { nonce: config.nonce, cookies: adminCookies });
    expect(withNonce.status).toBe(201);

    const withoutNonce = await rest(LEADS_PATH, validLead(), { cookies: adminCookies });
    expect(withoutNonce.status).toBe(403);
  });

  it('a thank_you attribute naming a page that does not exist gives a null thankYouUrl', async () => {
    const html = await wp(['eval', 'echo do_shortcode( \'[moving_quote thank_you="nope"]\' );']);
    const config = readConfig(html);
    expect(config.thankYouUrl).toBeNull();
  });

  it('a city name containing a quote and an angle bracket round-trips exactly through the rendered option', async () => {
    const before = await wp(['option', 'get', OPTION_NAME, '--format=json']);
    const settings = await wpJson<{ routes: { from: string; to: string; km: number }[] }>(['option', 'get', OPTION_NAME]);
    const trickyCity = 'Test"<b>City';

    try {
      settings.routes = [...settings.routes, { from: 'Barranquilla', to: trickyCity, km: 50 }];
      await wp(['option', 'update', OPTION_NAME, JSON.stringify(settings), '--format=json']);

      const res = await fetch(site(QUOTE_PAGE_PATH));
      const html = await res.text();

      // Both selects are still independently found with one extra city each: nothing from the
      // tricky city name broke out of its attribute and corrupted the surrounding markup (merging
      // selects, injecting a real <b> tag, or truncating the list).
      const originOptions = selectOptionValues(html, 'origin');
      const destinationOptions = selectOptionValues(html, 'destination');
      expect(originOptions).toHaveLength(8);
      expect(destinationOptions).toHaveLength(8);
      expect(html).not.toContain('<b>City');

      expect(originOptions).toContain(trickyCity);
    } finally {
      await wp(['option', 'update', OPTION_NAME, before, '--format=json']);
    }
  });
});
