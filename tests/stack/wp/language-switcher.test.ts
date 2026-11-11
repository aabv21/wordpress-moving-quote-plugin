import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { thankYouHref } from '../../../src/frontend/lib/reference.ts';
import { deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { disableDelivery, resetRateLimits, site, sqlWp, table, wp } from '../lib/stack.ts';

/** `setup.sh`'s pinned version. */
const POLYLANG_VERSION = '3.9.1';

/** The English and Spanish slug of each demo page, linked as translations by `setup.sh`. */
const PAGES = [
  { en: 'home', es: 'inicio' },
  { en: 'get-a-quote', es: 'cotizar' },
  { en: 'thank-you', es: 'gracias' },
] as const;

interface QuoteFormConfig {
  estimateUrl: string;
  leadsUrl: string;
  nonce: string;
  thankYouUrl: string | null;
}

/** Curly apostrophes become straight ones too, since WordPress texturizes titles and content. */
function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&#8217;', "'")
    .replaceAll('’', "'")
    .replaceAll('&#8211;', '–')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function readConfig(html: string): QuoteFormConfig {
  const match = /data-config="([^"]*)"/.exec(html);
  if (!match?.[1]) throw new Error('data-config attribute not found');
  return JSON.parse(decodeHtmlEntities(match[1])) as QuoteFormConfig;
}

/** The markup as served, for `readConfig()`: decoding first would break the attribute open. */
async function rawPage(path: string): Promise<string> {
  const res = await fetch(site(path));
  expect(res.status, path).toBe(200);
  return res.text();
}

async function page(path: string): Promise<string> {
  return decodeHtmlEntities(await rawPage(path));
}

/** The theme's header navigation, where `setup.sh` puts the menu and the switcher. */
function headerNav(html: string): string {
  const nav = /<nav\b[^>]*\bwp-block-navigation\b[\s\S]*?<\/nav>/.exec(html)?.[0];
  if (nav === undefined) throw new Error('no header navigation');
  return nav;
}

/** The `href` of the switcher's link to a language, by its `hreflang`. */
function switcherHref(nav: string, hreflang: string): string | undefined {
  const link = [...nav.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(` hreflang="${hreflang}"`));
  return link === undefined ? undefined : /\bhref="([^"]*)"/.exec(link)?.[1];
}

/** `wp eval` has no `--format`, so the script prints JSON itself. */
async function evalJson(script: string): Promise<unknown> {
  return JSON.parse(await wp(['eval', script])) as unknown;
}

async function postJson(url: string, body: unknown, nonce?: string): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (nonce !== undefined) headers['X-WP-Nonce'] = nonce;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

describe('the language switcher (Polylang)', () => {
  let restoreDelivery: () => Promise<void>;

  beforeAll(async () => {
    // Every path below assumes English is the default language, as in CI's .env.example.
    const defaultLanguage = (await wp(['eval', 'echo pll_default_language();'])).trim();
    if (defaultLanguage !== 'en') throw new Error(`these tests need SITE_LOCALE=en_US; the default language is ${defaultLanguage}`);
    restoreDelivery = await disableDelivery();
  });

  afterEach(async () => {
    await resetRateLimits();
  });

  afterAll(async () => {
    await restoreDelivery();
    await deleteCreatedLeads();
  });

  it('runs the pinned Polylang version', async () => {
    await expect(wp(['plugin', 'is-active', 'polylang'])).resolves.toBeDefined();
    await expect(wp(['plugin', 'get', 'polylang', '--field=version'])).resolves.toBe(`${POLYLANG_VERSION}\n`);
  });

  it('has English and Spanish, in that order, English the default', async () => {
    await expect(evalJson('echo wp_json_encode( pll_languages_list( [ "fields" => "locale" ] ) );')).resolves.toEqual(['en_US', 'es_CO']);
  });

  it('links each English page to its Spanish translation', async () => {
    for (const { en, es } of PAGES) {
      const script = `$en = get_page_by_path( '${en}' ); $es = get_page_by_path( '${es}' ); echo wp_json_encode( [ pll_get_post_language( $en->ID ), pll_get_post_language( $es->ID ), pll_get_post( $en->ID, 'es' ) === $es->ID ] );`;
      await expect(evalJson(script), en).resolves.toEqual(['en', 'es', true]);
    }
  });

  it('serves the Spanish pages under /es/, in Spanish', async () => {
    const home = await page('/es/');
    expect(home).toMatch(/<html[^>]*\blang="es-CO"/);
    expect(home).toContain('Su mudanza, sin complicaciones, en la costa Caribe de Colombia');
    expect(home).toContain('href="/es/cotizar/"');
    // The tagline is one option; Polylang's string translations give each language its own.
    expect(home).toContain('Mudanzas en la costa Caribe colombiana');

    const quote = await page('/es/cotizar/');
    expect(quote).toContain('Cuéntenos sobre su mudanza y vea un precio estimado al instante.');
    for (const text of ['Su mudanza', 'Servicios adicionales', 'Sus datos', 'Siguiente', 'Enviar mi solicitud']) expect(quote).toContain(text);

    const thanks = await page('/es/gracias/?reference=MQ-1A2B3C4D');
    expect(thanks).toContain('Recibimos su solicitud de mudanza.');
    expect(thanks).toContain('Su número de referencia es');
  });

  it('keeps the English pages unprefixed, in English', async () => {
    const home = await page('/');
    expect(home).toMatch(/<html[^>]*\blang="en-US"/);
    expect(home).toContain("Moving made simple on Colombia's Caribbean coast");
    expect(home).toContain("Moving across Colombia's Caribbean coast");

    const quote = await page('/get-a-quote/');
    for (const text of ['Your move', 'Extra services', 'Your details']) expect(quote).toContain(text);
  });

  it('puts the menu and an EN | ES switcher in the header, both following the page language', async () => {
    const english = headerNav(await page('/get-a-quote/'));
    expect(english).toContain('>Get a Quote<');
    expect(english).not.toContain('Cotizar');
    expect(switcherHref(english, 'es-CO')).toMatch(/\/es\/cotizar\/$/);
    expect(english).toMatch(/>EN</);
    expect(english).toMatch(/>ES</);

    const spanish = headerNav(await page('/es/cotizar/'));
    expect(spanish).toContain('>Inicio<');
    expect(spanish).toContain('>Cotizar<');
    expect(spanish).not.toContain('Get a Quote');
    expect(spanish).not.toContain('/es/gracias/');
    expect(switcherHref(spanish, 'en-US')).toMatch(/\/get-a-quote\/$/);
  });

  it("points the Spanish form at the Spanish thank-you page, and its REST URLs at the page's language", async () => {
    const config = readConfig(await rawPage('/es/cotizar/'));
    expect(config.thankYouUrl).toMatch(/\/es\/gracias\/$/);
    expect(config.estimateUrl).toMatch(/\/wp-json\/moving-quote\/v1\/estimate\?locale=es_CO$/);
    expect(config.leadsUrl).toMatch(/\/wp-json\/moving-quote\/v1\/leads\?locale=es_CO$/);
  });

  it('answers the Spanish form in Spanish: field messages and the price', async () => {
    const config = readConfig(await rawPage('/es/cotizar/'));

    const invalid = await postJson(config.estimateUrl, { move_type: 'apartment', rooms: 2, origin: 'Barranquilla' });
    expect(invalid.status).toBe(422);
    const body = invalid.json as { message: string; data: { errors: Record<string, string> } };
    expect(body.message).toBe('Corrija los campos resaltados.');
    expect(body.data.errors.destination).toBe('Este campo es obligatorio.');

    const estimate = await postJson(config.estimateUrl, { move_type: 'apartment', rooms: 2, origin: 'Barranquilla', destination: 'Cartagena', extras: [] });
    expect(estimate.status).toBe(200);
    const separator = await wp(['eval', 'switch_to_locale( "es_CO" ); global $wp_locale; echo $wp_locale->number_format["thousands_sep"];']);
    const group = (n: number): string => new Intl.NumberFormat('en-US').format(n).replaceAll(',', separator);
    expect((estimate.json as { display: string }).display).toBe(`COP ${group(1017000)} – ${group(1243000)}`);
  });

  it('stores es_CO for a lead sent from the Spanish page, then lands on the Spanish thank-you page', async () => {
    const config = readConfig(await rawPage('/es/cotizar/'));
    const lead = validLead();

    const res = await postJson(config.leadsUrl, lead, config.nonce);
    expect(res.status).toBe(201);
    const rows = await sqlWp(`SELECT locale FROM ${await table()} WHERE request_uuid = '${String(lead.submission_id)}'`);
    expect(rows).toEqual([{ locale: 'es_CO' }]);

    // The same redirect the browser makes after a 201.
    const reference = (res.json as { reference: string }).reference;
    if (config.thankYouUrl === null) throw new Error('no thank-you page');
    const thanks = await fetch(thankYouHref(config.thankYouUrl, reference));
    expect(thanks.status).toBe(200);
    expect(new URL(thanks.url).pathname).toBe('/es/gracias/');
    expect(decodeHtmlEntities(await thanks.text())).toContain(`Su número de referencia es <strong translate="no" style="white-space: nowrap">${reference}</strong>`);
  });

  it('stores en_US for a lead sent from the English page', async () => {
    const config = readConfig(await rawPage('/get-a-quote/'));
    const lead = validLead();

    const res = await postJson(config.leadsUrl, lead, config.nonce);
    expect(res.status).toBe(201);
    const rows = await sqlWp(`SELECT locale FROM ${await table()} WHERE request_uuid = '${String(lead.submission_id)}'`);
    expect(rows).toEqual([{ locale: 'en_US' }]);
  });

  it('ignores a locale that is not installed, falling back to the site language', async () => {
    const config = readConfig(await rawPage('/get-a-quote/'));
    const lead = validLead();

    const res = await postJson(config.leadsUrl.replace('locale=en_US', 'locale=fr_FR'), lead, config.nonce);
    expect(res.status).toBe(201);
    const rows = await sqlWp(`SELECT locale FROM ${await table()} WHERE request_uuid = '${String(lead.submission_id)}'`);
    expect(rows).toEqual([{ locale: 'en_US' }]);
  });
});
