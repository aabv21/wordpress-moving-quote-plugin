import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import { site, wp, wpJson } from '../lib/stack.ts';

const execFileAsync = promisify(execFile);

/** Every page `setup.sh` builds, in both languages, English the default. */
const PAGE_PATHS = ['/', '/get-a-quote/', '/thank-you/', '/data-policy/', '/es/', '/es/cotizar/', '/es/gracias/', '/es/politica-de-datos/'];
const PAGE_SLUGS = ['home', 'get-a-quote', 'thank-you', 'data-policy', 'inicio', 'cotizar', 'gracias', 'politica-de-datos'];

/** Curly apostrophes become straight ones too, since WordPress texturizes content. */
function decodeHtmlEntities(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&#8217;', "'")
    .replaceAll('’', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&#038;', '&')
    .replaceAll('&amp;', '&');
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

    expect(await page('/es/')).toContain('Su mudanza, sin complicaciones');
    expect(await page('/')).toContain('Moving made simple');
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
});
