import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { site, wp, wpJson } from '../lib/stack.ts';

const execFileAsync = promisify(execFile);

/** Every page `setup.sh` builds, in both languages, English the default. */
const PAGE_PATHS = ['/', '/get-a-quote/', '/thank-you/', '/data-policy/', '/es/', '/es/cotizar/', '/es/gracias/', '/es/politica-de-datos/'];
const PAGE_SLUGS = ['home', 'get-a-quote', 'thank-you', 'data-policy', 'inicio', 'cotizar', 'gracias', 'politica-de-datos'];

/** Curly apostrophes become straight ones too, since WordPress texturizes content. One pass, so `&#038;amp;` stays `&amp;`. */
const ENTITIES: Record<string, string> = { '&quot;': '"', '&#039;': "'", '&#8217;': "'", '&lt;': '<', '&gt;': '>', '&#038;': '&', '&amp;': '&' };
function decodeHtmlEntities(text: string): string {
  return text.replaceAll('\u2019', "'").replace(/&(?:quot|#039|#8217|lt|gt|#038|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

async function page(path: string): Promise<string> {
  const res = await fetch(site(path));
  expect(res.status, path).toBe(200);
  return decodeHtmlEntities(await res.text());
}

async function homeId(): Promise<string> {
  return (await wp(['post', 'list', '--post_type=page', '--name=home', '--field=ID'])).trim();
}

async function homeContent(): Promise<string> {
  return (await wp(['post', 'get', await homeId(), '--field=post_content'])).trim();
}

describe('the Chivabox theme', () => {
  it('activates the Chivabox child theme of Twenty Twenty-Five', async () => {
    await expect(wp(['theme', 'list', '--status=active', '--field=name'])).resolves.toBe('chivabox\n');
    await expect(wp(['theme', 'get', 'chivabox', '--field=parent_theme'])).resolves.toContain('Twenty Twenty-Five');
  });

  it('builds every page from a theme pattern, in both languages', async () => {
    for (const path of PAGE_PATHS) await page(path);

    const pages = await wpJson<{ post_name: string; post_content: string }[]>(['post', 'list', '--post_type=page', '--post_status=publish', '--fields=post_name,post_content']);
    for (const slug of PAGE_SLUGS) {
      const content = pages.find((row) => row.post_name === slug)?.post_content;
      expect(content, slug).toMatch(/^<!-- wp:pattern \{"slug":"chivabox\/[a-z-]+"\} \/-->$/);
    }

    expect(await page('/es/')).toContain('Su mudanza en la costa Caribe, bien hecha');
    expect(await page('/')).toContain('Moving on the Caribbean coast, done right');
  });

  it('SETUP_REFRESH_PAGES=1 rewrites a page whose content was edited, and a plain run leaves it', async () => {
    await wp(['post', 'update', await homeId(), '--post_content=<p>edited</p>']);

    await execFileAsync('./setup.sh');
    await expect(homeContent()).resolves.toBe('<p>edited</p>');

    await execFileAsync('./setup.sh', [], { env: { ...process.env, SETUP_REFRESH_PAGES: '1' } });
    await expect(homeContent()).resolves.toBe('<!-- wp:pattern {"slug":"chivabox/home"} /-->');
  });

  it('prints MovingCompany JSON-LD on the front page with every route city in areaServed', async () => {
    const home = await (await fetch(site('/'))).text();
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)?.[1];
    expect(json).toBeDefined();
    const graph = JSON.parse(json!) as { '@type': string; telephone: string; areaServed: { name: string }[] };
    expect(graph['@type']).toBe('MovingCompany');
    expect(graph.telephone).toBe('+570000000099');
    // Shortcode::cities(): every city with a route, sorted as the form's selects list them.
    expect(graph.areaServed.map((city) => city.name)).toEqual(['Barranquilla', 'Cartagena', 'Montería', 'Riohacha', 'Santa Marta', 'Sincelejo', 'Valledupar']);

    // Polylang serves the Spanish home as the front page too.
    const spanish = await (await fetch(site('/es/'))).text();
    const spanishJson = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(spanish)?.[1];
    expect(JSON.parse(spanishJson ?? '{}')).toMatchObject({ '@type': 'MovingCompany', inLanguage: 'es-CO' });

    const quote = await (await fetch(site('/get-a-quote/'))).text();
    expect(quote).not.toContain('application/ld+json');
  });

  describe('route chips and the quote prefill', () => {
    let chipsPageId = '';

    afterAll(async () => {
      if (chipsPageId !== '') await wp(['post', 'delete', chipsPageId, '--force']);
    });

    it('a route chip links to the quote page with both cities, and the quote form arrives with them selected', async () => {
      chipsPageId = (await wp(['post', 'create', '--post_type=page', '--post_status=publish', '--post_title=Chips', '--post_name=route-chips-test', '--post_content=[moving_quote_routes]', '--porcelain'])).trim();
      const html = await page('/route-chips-test/');
      const chip = /<a class="moving-quote-route" href="([^"]*)">([\s\S]*?)<\/a>/.exec(html);
      expect(chip?.[1]).toBe(site('/get-a-quote/?mq_from=Barranquilla&mq_to=Cartagena'));
      expect(chip?.[2]).toContain('from COP 882,000');

      const quote = await page(new URL(chip![1]!).pathname + new URL(chip![1]!).search);
      const origin = /<select[^>]*\bid="mq-origin"[^>]*>([\s\S]*?)<\/select>/.exec(quote)?.[1];
      expect(origin).toMatch(/<option value="Barranquilla" selected/);
      expect(origin).not.toMatch(/<option value="" disabled selected/);
    });

    it('ignores a prefilled city that is not in the table', async () => {
      const quote = await page('/get-a-quote/?mq_from=%3Cscript%3Ex&mq_to=Cartagena');
      const form = /<form class="moving-quote"[\s\S]*?<\/form>/.exec(quote)?.[0] ?? '';
      const origin = /<select[^>]*\bid="mq-origin"[^>]*>([\s\S]*?)<\/select>/.exec(form)?.[1];
      expect(origin).toMatch(/<option value="" disabled selected/);
      expect(form).not.toContain('%3Cscript');
      expect(form).not.toContain('<script>x');
    });
  });

  it('the home page renders every section, in English and Spanish', async () => {
    const english = await page('/');
    for (const text of ['How it works', 'What we move', 'Popular routes', 'What customers say', 'Questions', 'Ready when you are', 'Sample reviews for this demo']) expect(english, text).toContain(text);
    const spanish = await page('/es/');
    for (const text of ['Cómo funciona', 'Qué movemos', 'Rutas frecuentes', 'Lo que dicen nuestros clientes', 'Preguntas frecuentes', 'Listos cuando usted lo esté', 'Reseñas de ejemplo para esta demostración']) expect(spanish, text).toContain(text);
    expect(english).not.toContain('wp-block-post-title');
    expect(spanish).not.toContain('wp-block-post-title');
  });

  it("serves the theme's own fonts and no Google Fonts", async () => {
    const home = await page('/');
    expect(home).toContain('/themes/chivabox/assets/fonts/figtree-latin-400-normal.woff2');
    expect(home).not.toContain('fonts.googleapis.com');
    expect(home).not.toContain('fonts.gstatic.com');
  });

  it('the header switcher shows English and Español and marks the current language', async () => {
    const switcherLinks = (html: string): string[] => [...html.matchAll(/<li\b[^>]*>\s*<a\b[^>]*\bhreflang="[^"]*"[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);
    const english = switcherLinks(await page('/'));
    expect(english.join('\n')).toContain('>English<');
    expect(english.join('\n')).toContain('>Español<');
    expect(english.find((item) => item.includes('>English<'))).toContain('current-lang');
    for (const item of english) expect(item).toMatch(/\blang="(en-US|es-CO)"/);

    const spanish = switcherLinks(await page('/es/'));
    expect(spanish.find((item) => item.includes('>Español<'))).toContain('current-lang');
  });

  it('the footer shows the business phone, WhatsApp, address, hours, tax ID, the data policy link and the demo notice', async () => {
    const footerOf = async (path: string): Promise<string> => /<footer\b[\s\S]*<\/footer>/.exec(await page(path))?.[0] ?? '';
    const english = await footerOf('/');
    for (const text of ['+57 000 000 0099', 'https://wa.me/570000000099', 'Calle 00 # 00-00, Barranquilla', 'Monday to Saturday, 07:00 to 18:00', 'NIT 000.000.000-0<', 'Data processing policy', 'Demo site, fictional company and tax ID.']) expect(english, text).toContain(text);
    const spanish = await footerOf('/es/');
    for (const text of ['Lunes a sábado, de 07:00 a 18:00', 'Política de tratamiento de datos', 'Sitio de demostración, empresa y NIT ficticios.']) expect(spanish, text).toContain(text);
  });

  it('the header links WhatsApp, and no shortcode is left unrendered in the header or footer', async () => {
    for (const path of ['/', '/get-a-quote/', '/es/']) {
      const html = await page(path);
      const header = /<header\b[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
      expect(header, path).toContain('class="moving-quote-contact__whatsapp" href="https://wa.me/570000000099"');
      expect(header, path).toContain('class="moving-quote-contact__phone" href="tel:+570000000099">+57 000 000 0099</a>');
      // The logo already links home, so the menu doesn't repeat it.
      expect(header, path).not.toMatch(/>(Home|Inicio)</);
      expect(html, path).not.toMatch(/\[moving_quote_[a-z]+[^\]]*\]/);
    }
  });

  it('prints no contact block, link or empty line when every business detail is blank', async () => {
    const keys = ['business_phone', 'business_whatsapp', 'business_street', 'business_city', 'business_hours_open', 'business_hours_close', 'business_tax_id'];
    const before = await wpJson<Record<string, unknown>>(['option', 'get', 'moving_quote_settings']);
    try {
      for (const key of keys) await wp(['option', 'patch', 'update', 'moving_quote_settings', key, '']);
      const home = await page('/');
      expect(home).not.toContain('moving-quote-contact');
      expect(home).not.toContain('tel:');
      expect(home).not.toContain('wa.me');
      expect(home).not.toMatch(/<address\b/);
      const graph = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)?.[1] ?? '{}') as Record<string, unknown>;
      for (const property of ['telephone', 'address', 'openingHoursSpecification']) expect(graph, property).not.toHaveProperty(property);
    } finally {
      await wp(['option', 'update', 'moving_quote_settings', JSON.stringify(before), '--format=json']);
    }
  });

  it('prints no shortcode text on any page while the plugin is inactive', async () => {
    await wp(['plugin', 'deactivate', 'moving-quote']);
    try {
      for (const path of ['/', '/get-a-quote/', '/thank-you/', '/es/']) {
        const html = await page(path);
        expect(html, path).not.toMatch(/\[moving_quote/);
      }
    } finally {
      await wp(['plugin', 'activate', 'moving-quote']);
    }
  });

  it('prints a meta description and Open Graph tags on every page', async () => {
    const meta = (html: string, attribute: 'name' | 'property', key: string): string | undefined =>
      [...html.matchAll(/<meta (name|property)="([^"]+)" content="([^"]*)"/g)].find((match) => match[1] === attribute && match[2] === key)?.[3];
    const cases = [
      ['/', 'Home and office moves between Barranquilla, Cartagena and Santa Marta. See an instant estimate and book a crew.', 'en_US'],
      ['/get-a-quote/', 'Answer three short steps and see your moving estimate in Colombian pesos right away.', 'en_US'],
      ['/es/cotizar/', 'Responda tres pasos cortos y vea al instante el precio estimado de su mudanza en pesos colombianos.', 'es_CO'],
    ] as const;
    for (const [path, description, locale] of cases) {
      const html = await page(path);
      expect(meta(html, 'name', 'description'), path).toBe(description);
      expect(meta(html, 'property', 'og:description'), path).toBe(description);
      expect(meta(html, 'property', 'og:image'), path).toMatch(/\/assets\/images\/og-default\.jpg$/);
      expect(meta(html, 'property', 'og:locale'), path).toBe(locale);
      expect(meta(html, 'name', 'twitter:card'), path).toBe('summary_large_image');
    }
  });

  it('the Spanish home has no English left in the header or footer', async () => {
    const spanish = await page('/es/');
    const regions = [/<header\b[\s\S]*?<\/header>/.exec(spanish)?.[0] ?? '', /<footer\b[\s\S]*<\/footer>/.exec(spanish)?.[0] ?? ''];
    expect(regions[0]).not.toBe('');
    for (const region of regions) {
      for (const english of ['>Home<', 'Get a quote', 'Designed with WordPress', 'Monday', 'fictional', 'Demo site']) expect(region, english).not.toContain(english);
    }
  });
});
