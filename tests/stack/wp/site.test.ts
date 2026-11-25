import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
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
});
