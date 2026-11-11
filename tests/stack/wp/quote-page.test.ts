import { readFileSync } from 'node:fs';
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

function decodeHtmlEntities(text: string): string {
  return text.replaceAll('&quot;', '"').replaceAll('&#039;', "'").replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>');
}

/** By regex: this repo has no HTML parser dependency. */
function readConfig(html: string): QuoteFormConfig {
  const match = /data-config="([^"]*)"/.exec(html);
  if (!match?.[1]) throw new Error('data-config attribute not found');
  return JSON.parse(decodeHtmlEntities(match[1])) as QuoteFormConfig;
}

const SELECT_PATTERNS = {
  origin: /<select[^>]*\bname="origin"[^>]*>([\s\S]*?)<\/select>/,
  destination: /<select[^>]*\bname="destination"[^>]*>([\s\S]*?)<\/select>/,
} as const;

/** Skips the empty-value placeholder. */
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

  // Registered first so its afterAll runs last, after the city-name test restores a snapshot holding ''.
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
    // Cron would retry a leftover pending lead for hours.
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
    // Its wrapper is hidden from assistive technology, so the "leave this empty" label is never read out.
    const honeypotWrapper = /<p[^>]*\bclass="[^"]*moving-quote__honeypot[^"]*"[^>]*>/.exec(html)?.[0];
    expect(honeypotWrapper).toContain('aria-hidden="true"');

    expect(html).toMatch(/<script[^>]*\bsrc="[^"]*\/plugins\/moving-quote\/assets\/quote-form\.js[^"]*"/);

    const config = readConfig(html);
    expect(typeof config.nonce).toBe('string');
    expect(config.nonce.length).toBeGreaterThan(0);
    // Each REST URL carries the page's language, which the route then runs in.
    expect(config.estimateUrl).toMatch(/\/wp-json\/moving-quote\/v1\/estimate\?locale=en_US$/);
    expect(config.leadsUrl).toMatch(/\/wp-json\/moving-quote\/v1\/leads\?locale=en_US$/);
    expect(config.thankYouUrl).toMatch(/\/thank-you\/$/);
  });

  it('the rendered form and the DOM tests\' fixture carry exactly the same data hooks', async () => {
    const html = await (await fetch(site(QUOTE_PAGE_PATH))).text();
    const form = /<form\b[^>]*\bdata-moving-quote\b[\s\S]*?<\/form>/.exec(html)?.[0];
    if (form === undefined) throw new Error('the quote form was not rendered');
    // Each hook with its value (data-step="1", data-error-for="phone", …); data-config by name only.
    const hooksIn = (markup: string): string[] =>
      [...new Set([...markup.matchAll(/\bdata-[a-z-]+="[^"]*"|\bdata-[a-z-]+/g)].map(([hook]) => (hook.startsWith('data-config=') ? 'data-config=' : hook)))].sort();
    const fixture = hooksIn(readFileSync('tests/dom/fixtures/quote-form.html', 'utf8'));
    expect(fixture.length).toBeGreaterThan(20);
    expect(hooksIn(form)).toEqual(fixture);
  });

  it("sets the move-date input's min to today in America/Bogota, not the site's own configured timezone", async () => {
    const res = await fetch(site(QUOTE_PAGE_PATH));
    const html = await res.text();
    const min = /<input[^>]*\bid="mq-move-date"[^>]*\bmin="([^"]*)"/.exec(html)?.[1];
    expect(min).toBeDefined();

    const bogotaToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(min).toBe(bogotaToday);
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

      // Nothing from the tricky name broke out of its attribute.
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

/** Base64-encoded, so no quote or bracket in `value` can change the PHP that sets it. */
function renderReference(value: string): Promise<string> {
  const encoded = Buffer.from(value, 'utf8').toString('base64');
  return wp(['eval', `$_GET['reference'] = base64_decode( '${encoded}' ); echo do_shortcode( '[moving_quote_reference]' );`]);
}

describe('the thank-you page reference shortcode', () => {
  it('shows a well-formed reference from the query string', async () => {
    const html = await renderReference('MQ-0123ABCD');
    expect(html).toContain('<strong translate="no" style="white-space: nowrap">MQ-0123ABCD</strong>');
  });

  // The markup and newline cases would each sanitize down to a valid reference: they must still render nothing.
  it.each(['', 'mq-0123abcd', 'MQ-0123ABC', 'MQ-0123ABCD\n', 'MQ-0123ABCD<script>alert(1)</script>', '<b>MQ-0123ABCD</b>'])('renders nothing for %j', async (value) => {
    expect(await renderReference(value)).toBe('');
  });

  it('renders nothing when the page is opened without a reference', async () => {
    expect(await wp(['eval', "echo do_shortcode( '[moving_quote_reference]' );"])).toBe('');
  });
});
