import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePo, placeholders } from '../../../scripts/lib/gettext.ts';
import { deleteCreatedLeads, validLead } from '../lib/leads.ts';
import { disableDelivery, login, required, resetRateLimits, rest, restNonce, site, sqlWp, table, wp } from '../lib/stack.ts';

const SPANISH = 'es_CO';
const QUOTE_PAGE_PATH = '/get-a-quote/';
const LEADS_PAGE = '/wp-admin/admin.php?page=moving-quote';
const SETTINGS_PAGE = '/wp-admin/admin.php?page=moving-quote-settings';
const ESTIMATE_PATH = '/moving-quote/v1/estimate';
const LEADS_PATH = '/moving-quote/v1/leads';

/**
 * Through `$wpdb`, so the value lands exactly as given, whatever `update_option()`'s sanitizer
 * would do with it. `null` deletes the row.
 */
async function writeSiteLanguage(value: string | null): Promise<void> {
  const script = `<?php
global $wpdb;
$value = $args[0] ?? null;
if ( null === $value ) {
	$wpdb->delete( $wpdb->options, [ 'option_name' => 'WPLANG' ] );
} else {
	$wpdb->query( $wpdb->prepare( "INSERT INTO {$wpdb->options} (option_name, option_value, autoload) VALUES ('WPLANG', %s, 'on') ON DUPLICATE KEY UPDATE option_value = VALUES(option_value)", $value ) );
}
if ( '' !== $wpdb->last_error ) {
	fwrite( STDERR, $wpdb->last_error );
	exit( 1 );
}
`;
  await wp(value === null ? ['eval-file', '-'] : ['eval-file', '-', value], script);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&#8217;', '’')
    .replaceAll('&hellip;', '…')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The form alone, so the theme's and core's untranslated English never counts. */
function quoteForm(html: string): string {
  const form = /<form class="moving-quote"[\s\S]*?<\/form>/.exec(html)?.[0];
  if (form === undefined) throw new Error('the quote form was not rendered');
  return form;
}

/**
 * Sources with a distinct translation and no placeholder: each would appear verbatim if untranslated.
 */
function englishSources(): string[] {
  const po = parsePo(readFileSync('plugin/moving-quote/languages/moving-quote-es_CO.po', 'utf8'));
  return po.entries.filter((entry) => entry.msgidPlural === null && entry.msgstr[0] !== entry.msgid && placeholders(entry.msgid).length === 0).map((entry) => entry.msgid);
}

/** Not glued to a letter on either side. */
function containsPhrase(text: string, source: string): boolean {
  const isLetter = (char: string | undefined): boolean => char !== undefined && /[A-Za-z]/.test(char);
  for (let at = text.indexOf(source); at !== -1; at = text.indexOf(source, at + 1)) {
    if (!isLetter(text[at - 1]) && !isLetter(text[at + source.length])) return true;
  }
  return false;
}

function englishLeftovers(text: string, sources: string[]): string[] {
  return sources.filter((source) => containsPhrase(text, source));
}

/**
 * The plugin on its own, with no multilingual plugin: Polylang is deactivated for this file, so the
 * site language alone decides. `language-switcher.test.ts` covers the same plugin under Polylang.
 */
describe('the site in Spanish (WPLANG=es_CO), without Polylang', () => {
  let previousLanguage: string | null;
  let restoreDelivery: () => Promise<void>;
  let adminCookies: string;
  const sources = englishSources();

  beforeAll(async () => {
    const rows = await sqlWp("SELECT option_value FROM wp_options WHERE option_name = 'WPLANG'");
    previousLanguage = rows[0]?.option_value ?? null;
    restoreDelivery = await disableDelivery();
    await resetRateLimits();
    await wp(['plugin', 'deactivate', 'polylang']);
    await writeSiteLanguage(SPANISH);
    adminCookies = await login(required('WP_ADMIN_USER'), required('WP_ADMIN_PASSWORD'));
  });

  afterAll(async () => {
    await writeSiteLanguage(previousLanguage);
    // Activation drops the rewrite rules; the flush rebuilds them with Polylang's language prefixes.
    await wp(['plugin', 'activate', 'polylang']);
    await wp(['rewrite', 'flush', '--hard']);
    await restoreDelivery();
    await deleteCreatedLeads();
    await resetRateLimits();
  });

  it('switches the site locale, with no multilingual plugin active', async () => {
    await expect(wp(['eval', 'echo get_locale();'])).resolves.toBe(SPANISH);
    await expect(wp(['eval', "echo function_exists( 'pll_get_post' ) ? 'polylang' : 'none';"])).resolves.toBe('none');
  });

  it('renders the quote form in Spanish, with no English left in it', async () => {
    const res = await fetch(site(QUOTE_PAGE_PATH));
    expect(res.status).toBe(200);
    const markup = quoteForm(await res.text());
    const form = decodeHtmlEntities(markup);

    for (const text of ['Su mudanza', 'Servicios adicionales', 'Sus datos', '¿Qué va a mudar?', '¿Cuántas habitaciones?', 'Elija una ciudad', 'Siguiente', 'Atrás', 'Enviar mi solicitud', 'Precio estimado', 'Apartamento', 'Embalaje']) {
      expect(form).toContain(text);
    }
    // The strings the script writes itself travel through data-config, translated server-side.
    const config = JSON.parse(decodeHtmlEntities(/data-config="([^"]*)"/.exec(markup)?.[1] ?? '{}')) as { strings?: Record<string, string> };
    expect(config.strings).toEqual({
      sending: 'Enviando…',
      networkError: 'Algo salió mal. Revise su conexión e intente de nuevo.',
      rateLimited: 'Demasiadas solicitudes. Intente de nuevo más tarde.',
      sessionExpired: 'Su sesión expiró. Recargue la página e intente de nuevo.',
      genericError: 'Corrija los campos resaltados.',
    });

    expect(englishLeftovers(form, sources)).toEqual([]);
  });

  it('answers a REST 422 in Spanish, field messages included', async () => {
    const res = await rest(ESTIMATE_PATH, { move_type: 'apartment', rooms: 2, origin: 'Barranquilla' });
    expect(res.status).toBe(422);
    const body = res.json as { message: string; data: { errors: Record<string, string> } };
    expect(body.message).toBe('Corrija los campos resaltados.');
    expect(body.data.errors.destination).toBe('Este campo es obligatorio.');
  });

  it("formats the estimate's numbers with the site language's own separators", async () => {
    const res = await rest(ESTIMATE_PATH, { move_type: 'apartment', rooms: 2, origin: 'Barranquilla', destination: 'Cartagena', extras: [] });
    expect(res.status).toBe(200);
    // The separator comes from core's language pack, which this stack lacks; read it, don't assume.
    const separator = await wp(['eval', 'global $wp_locale; echo $wp_locale->number_format["thousands_sep"];']);
    const group = (n: number): string => new Intl.NumberFormat('en-US').format(n).replaceAll(',', separator);
    expect((res.json as { display: string }).display).toBe(`COP ${group(1017000)} – ${group(1243000)}`);
  });

  it('stores the Spanish locale on a lead submitted while the site is in Spanish', async () => {
    const lead = validLead();
    const res = await rest(LEADS_PATH, lead, { nonce: await restNonce() });
    expect(res.status).toBe(201);
    const rows = await sqlWp(`SELECT locale FROM ${await table()} WHERE request_uuid = '${String(lead.submission_id)}'`);
    expect(rows).toEqual([{ locale: SPANISH }]);
  });

  it('shows the thank-you reference line in Spanish', async () => {
    const res = await fetch(site('/thank-you/?reference=MQ-1A2B3C4D'));
    expect(decodeHtmlEntities(await res.text())).toContain('Su número de referencia es <strong translate="no" style="white-space: nowrap">MQ-1A2B3C4D</strong>. Téngalo a mano si se comunica con nosotros sobre su mudanza.');
  });

  it('renders the Leads and Settings admin pages in Spanish', async () => {
    const leads = decodeHtmlEntities(await (await fetch(site(LEADS_PAGE), { headers: { Cookie: adminCookies } })).text());
    for (const text of ['Cotizaciones de mudanza', 'Exportar CSV', 'Recibida', 'Referencia', 'Cliente', 'Envío', 'Todas']) expect(leads).toContain(text);
    expect(leads).toContain('>Nueva</option>');

    const settings = decodeHtmlEntities(await (await fetch(site(SETTINGS_PAGE), { headers: { Cookie: adminCookies } })).text());
    for (const text of ['Ajustes del cotizador de mudanzas', 'Tarifas', 'Ciudades y distancias', 'Secreto del webhook', 'Correo del equipo']) expect(settings).toContain(text);
  });
});
