import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { login, required, site, wp, wpJson } from '../lib/stack.ts';

const execFileAsync = promisify(execFile);

const SETTINGS_PATH = '/wp-admin/admin.php?page=moving-quote-settings';
const OPTION_NAME = 'moving_quote_settings';
const SUBSCRIBER_LOGIN = 'moving-quote-settings-subscriber';

const CITIES = ['Barranquilla', 'Cartagena', 'Montería', 'Riohacha', 'Santa Marta', 'Sincelejo', 'Valledupar'];

/**
 * Pulls every `moving_quote_settings[...]` form field out of a rendered settings page, along with
 * the `settings_fields()` hidden inputs needed to resubmit the form to `options.php`. This repo
 * has no HTML parser dependency, so this matches the plugin's own plain, single-line `<input>`
 * markup rather than parsing a full DOM.
 */
function scrapeForm(html: string): { fields: [string, string][]; wpNonce: string; optionPage: string; httpReferer: string } {
  const fields: [string, string][] = [];
  const nameValuePattern = /<input[^>]*\bname=(["'])(moving_quote_settings\[[^"']*\])\1[^>]*>/g;
  for (const inputTag of html.matchAll(nameValuePattern)) {
    const tag = inputTag[0];
    const name = inputTag[2];
    if (name === undefined) continue;
    // An unchecked checkbox never submits a value in a real browser; a text/password/email input
    // always does, even when its value is empty.
    if (/\btype=(["'])checkbox\1/.test(tag) && !/\bchecked\b/.test(tag)) continue;
    const valueMatch = /\bvalue=(["'])(.*?)\1/.exec(tag);
    fields.push([name, valueMatch?.[2] !== undefined ? decodeHtmlEntities(valueMatch[2]) : '']);
  }

  const wpNonce = /<input[^>]*\bname=(["'])_wpnonce\1[^>]*\bvalue=(["'])(.*?)\2/.exec(html)?.[3];
  const optionPage = /<input[^>]*\bname=(["'])option_page\1[^>]*\bvalue=(["'])(.*?)\2/.exec(html)?.[3];
  const httpReferer = /<input[^>]*\bname=(["'])_wp_http_referer\1[^>]*\bvalue=(["'])(.*?)\2/.exec(html)?.[3];
  if (wpNonce === undefined || optionPage === undefined || httpReferer === undefined) {
    throw new Error('settings form is missing a settings_fields() hidden input');
  }

  return { fields, wpNonce, optionPage, httpReferer: decodeHtmlEntities(httpReferer) };
}

function decodeHtmlEntities(text: string): string {
  return text.replaceAll('&#038;', '&').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#039;', "'");
}

/** Submits a scraped form to `options.php`, following WordPress's own post-save redirect. */
async function submitSettingsForm(scraped: ReturnType<typeof scrapeForm>, cookies: string, overrides: Record<string, string> = {}): Promise<Response> {
  const body = new URLSearchParams();
  body.set('option_page', scraped.optionPage);
  body.set('action', 'update');
  body.set('_wpnonce', scraped.wpNonce);
  body.set('_wp_http_referer', scraped.httpReferer);
  for (const [name, value] of scraped.fields) {
    body.set(name, Object.hasOwn(overrides, name) ? overrides[name]! : value);
  }

  return fetch(site('/wp-admin/options.php'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body,
    redirect: 'manual',
  });
}

async function fetchSettingsPage(cookies?: string): Promise<Response> {
  return fetch(site(SETTINGS_PATH), { headers: cookies !== undefined ? { Cookie: cookies } : {}, redirect: 'manual' });
}

describe('settings page', () => {
  let adminCookies: string;

  beforeAll(async () => {
    adminCookies = await login(required('WP_ADMIN_USER'), required('WP_ADMIN_PASSWORD'));
  });

  it('redirects an anonymous visitor to the login page', async () => {
    const res = await fetchSettingsPage();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('wp-login.php');
  });

  it('returns 403 for a logged-in subscriber', async () => {
    const password = randomBytes(18).toString('hex');
    await wp(['user', 'create', SUBSCRIBER_LOGIN, `${SUBSCRIBER_LOGIN}@example.com`, '--role=subscriber', `--user_pass=${password}`]);
    try {
      const subscriberCookies = await login(SUBSCRIBER_LOGIN, password);
      const res = await fetchSettingsPage(subscriberCookies);
      const html = await res.text();
      expect(res.status).toBe(403);
      expect(html).toContain('Sorry, you are not allowed to access this page.');
    } finally {
      await wp(['user', 'delete', SUBSCRIBER_LOGIN, '--yes']);
    }
  });

  it('shows every city, an empty secret field, and never the real secret, to an admin', async () => {
    const res = await fetchSettingsPage(adminCookies);
    expect(res.status).toBe(200);
    const html = await res.text();

    for (const city of CITIES) {
      expect(html).toContain(city);
    }

    const secretInput = /<input[^>]*\bname=(["'])moving_quote_settings\[webhook_secret\]\1[^>]*>/.exec(html)?.[0];
    expect(secretInput).toBeDefined();
    expect(secretInput).toMatch(/\bvalue=(["'])\1/);

    expect(html).not.toContain(required('LEAD_WEBHOOK_SECRET'));
  });

  it('accepts a Colombian-formatted amount and changes nothing else', async () => {
    const before = await wpJson<Record<string, unknown>>(['option', 'get', OPTION_NAME]);
    const page = await fetchSettingsPage(adminCookies);
    const scraped = scrapeForm(await page.text());

    const res = await submitSettingsForm(scraped, adminCookies, { 'moving_quote_settings[per_km]': '4.500' });
    expect(res.status).toBe(302);

    const after = await wpJson<Record<string, unknown>>(['option', 'get', OPTION_NAME]);
    expect(after['per_km']).toBe(4500);
    expect({ ...after, per_km: before['per_km'] }).toEqual(before);
  });

  it('rejects an amount typo, keeps the last valid value, and shows the error notice', async () => {
    const page = await fetchSettingsPage(adminCookies);
    const scraped = scrapeForm(await page.text());

    const res = await submitSettingsForm(scraped, adminCookies, { 'moving_quote_settings[per_km]': '3.5' });
    expect(res.status).toBe(302);

    const after = await wpJson<{ per_km: number }>(['option', 'get', OPTION_NAME]);
    expect(after.per_km).toBe(4500);

    // WordPress's settings_errors() reads its notices from a one-time transient, and only when
    // ?settings-updated is present, so the notice shows only by following options.php's own
    // post-save redirect (which carries that query arg) — not a plain re-GET of the bare page.
    const redirectLocation = res.headers.get('location');
    expect(redirectLocation).toBeDefined();
    const afterSave = await fetch(site(redirectLocation!), { headers: { Cookie: adminCookies } });
    const html = await afterSave.text();
    expect(html).toContain('notice-error');
  });

  it('rejects a bad webhook URL scheme, keeps the current URL, and shows the error notice', async () => {
    const before = await wpJson<{ webhook_url: string }>(['option', 'get', OPTION_NAME]);
    const page = await fetchSettingsPage(adminCookies);
    const scraped = scrapeForm(await page.text());

    const res = await submitSettingsForm(scraped, adminCookies, { 'moving_quote_settings[webhook_url]': 'javascript:alert(1)' });
    expect(res.status).toBe(302);

    const after = await wpJson<{ webhook_url: string }>(['option', 'get', OPTION_NAME]);
    expect(after.webhook_url).toBe(before.webhook_url);

    const redirectLocation = res.headers.get('location');
    expect(redirectLocation).toBeDefined();
    const afterSave = await fetch(site(redirectLocation!), { headers: { Cookie: adminCookies } });
    const html = await afterSave.text();
    expect(html).toContain('notice-error');
  });

  it('saves a secret containing percent-encoding, a tag, a backslash, and inner spaces exactly, through the real form', async () => {
    const before = await wpJson<{ webhook_secret: string }>(['option', 'get', OPTION_NAME]);
    const trickySecret = `${'x'.repeat(20)} %41 <tag> \\ ${'y'.repeat(20)}`;

    try {
      const page = await fetchSettingsPage(adminCookies);
      const scraped = scrapeForm(await page.text());

      const res = await submitSettingsForm(scraped, adminCookies, { 'moving_quote_settings[webhook_secret]': trickySecret });
      expect(res.status).toBe(302);

      const after = await wpJson<{ webhook_secret: string }>(['option', 'get', OPTION_NAME]);
      expect(after.webhook_secret === trickySecret).toBe(true);
    } finally {
      await wp(['option', 'patch', 'update', OPTION_NAME, 'webhook_secret'], before.webhook_secret);
    }
  });

  it('after ./setup.sh, stores the fixed webhook URL and the .env secret and team email, without printing the secret', async () => {
    await execFileAsync('./setup.sh');

    const stored = await wpJson<{ webhook_url: string; webhook_secret: string; team_email: string }>(['option', 'get', OPTION_NAME]);

    expect(stored.webhook_url).toBe('http://n8n:5678/webhook/moving-quote/leads');
    expect(stored.team_email).toBe(required('TEAM_EMAIL'));
    expect(stored.webhook_secret === required('LEAD_WEBHOOK_SECRET')).toBe(true);
  });

  afterAll(async () => {
    await wp(['option', 'patch', 'update', OPTION_NAME, 'per_km', '4000', '--format=json']);
  });
});
