import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { clearDebugLog, pluginLogLines, site, wp, wpJson } from '../lib/stack.ts';

const execFileAsync = promisify(execFile);

/** Each demo page in English, then in Spanish (Polylang needs a distinct slug per language). */
const SLUGS = ['home', 'get-a-quote', 'thank-you', 'inicio', 'cotizar', 'gracias', 'data-policy', 'politica-de-datos', 'my-move', 'mi-mudanza'] as const;

interface WpPage {
  ID: number;
  post_title: string;
  post_status: string;
}

interface WpNavigation {
  ID: number;
  post_status: string;
  post_content: string;
}

const NAVIGATION_ARGS = ['post', 'list', '--post_type=wp_navigation', '--name=primary-navigation'];
const SPANISH_NAVIGATION_ARGS = ['post', 'list', '--post_type=wp_navigation', '--name=navegacion-principal'];
const SWITCHER_BLOCK = '<!-- wp:polylang/navigation-language-switcher {"show_labels":"names"} /-->';

describe('WordPress runtime, after setup.sh', () => {
  beforeAll(async () => {
    await clearDebugLog();
    await execFileAsync('./setup.sh');
  });

  it('is installed', async () => {
    await expect(wp(['core', 'is-installed'])).resolves.toBeDefined();
  });

  it('sets the Bogota timezone', async () => {
    await expect(wp(['option', 'get', 'timezone_string'])).resolves.toBe('America/Bogota\n');
  });

  it('activates the Chivabox theme, a child of the default theme', async () => {
    const defaultTheme = (await wp(['eval', 'echo WP_DEFAULT_THEME;'])).trim();
    expect(defaultTheme).toBe('twentytwentyfive');
    const active = await wpJson<{ name: string }[]>(['theme', 'list', '--status=active', '--fields=name']);
    expect(active).toEqual([{ name: 'chivabox' }]);
    await expect(wp(['theme', 'get', 'chivabox', '--field=template'])).resolves.toBe(`${defaultTheme}\n`);
  });

  it('creates exactly one published page per slug', async () => {
    for (const slug of SLUGS) {
      const pages = await wpJson<WpPage[]>(['post', 'list', '--post_type=page', `--name=${slug}`, '--fields=ID,post_title,post_status']);
      expect(pages).toHaveLength(1);
      expect(pages[0]?.post_status).toBe('publish');
    }
  });

  it('creates one primary navigation menu that links Get a quote, never the thank-you page', async () => {
    const menus = await wpJson<WpNavigation[]>([...NAVIGATION_ARGS, '--fields=ID,post_status,post_content']);
    expect(menus).toHaveLength(1);
    expect(menus[0]?.post_status).toBe('publish');
    expect(menus[0]?.post_content).toContain('"url":"/get-a-quote/"');
    // The logo already links home, so the menu doesn't repeat it.
    expect(menus[0]?.post_content).not.toContain('"url":"/"');
    expect(menus[0]?.post_content).toContain(SWITCHER_BLOCK);
    expect(menus[0]?.post_content).not.toContain('thank-you');
  });

  it('creates its Spanish translation, linking Cotizar under /es/', async () => {
    const menus = await wpJson<WpNavigation[]>([...SPANISH_NAVIGATION_ARGS, '--fields=ID,post_status,post_content']);
    expect(menus).toHaveLength(1);
    expect(menus[0]?.post_status).toBe('publish');
    expect(menus[0]?.post_content).toContain('"label":"Cotizar","url":"/es/cotizar/"');
    expect(menus[0]?.post_content).toContain(SWITCHER_BLOCK);
    expect(menus[0]?.post_content).not.toContain('gracias');
  });

  it("uses each language's menu as the theme's header navigation", async () => {
    const navOf = async (path: string): Promise<string | undefined> => /<nav\b[^>]*\bwp-block-navigation\b[\s\S]*?<\/nav>/.exec(await (await fetch(site(path))).text())?.[0];

    const english = await navOf('/');
    expect(english).toBeDefined();
    expect(english).toContain('/get-a-quote/');
    expect(english).not.toContain('/thank-you/');

    const spanish = await navOf('/es/');
    expect(spanish).toBeDefined();
    expect(spanish).toContain('/es/cotizar/');
    expect(spanish).not.toContain('/es/gracias/');
  });

  it('sets page_on_front to the home page', async () => {
    const [home] = await wpJson<WpPage[]>(['post', 'list', '--post_type=page', '--name=home', '--fields=ID']);
    const pageOnFront = (await wp(['option', 'get', 'page_on_front'])).trim();
    expect(pageOnFront).toBe(String(home?.ID));
  });

  it('activates the moving-quote plugin', async () => {
    await expect(wp(['plugin', 'is-active', 'moving-quote'])).resolves.toBeDefined();
  });

  it('serves the home and quote pages over HTTP, in both languages', async () => {
    for (const path of ['/', '/get-a-quote/', '/es/', '/es/cotizar/']) {
      const res = await fetch(site(path));
      expect(res.status, path).toBe(200);
    }
  });

  it('stays idempotent: a second run creates no duplicate pages or menus', async () => {
    await execFileAsync('./setup.sh');
    for (const slug of SLUGS) {
      const pages = await wpJson<WpPage[]>(['post', 'list', '--post_type=page', `--name=${slug}`, '--fields=ID']);
      expect(pages).toHaveLength(1);
    }
    for (const args of [NAVIGATION_ARGS, SPANISH_NAVIGATION_ARGS]) {
      const menus = await wpJson<WpNavigation[]>([...args, '--fields=ID,post_content']);
      expect(menus).toHaveLength(1);
      // The switcher is appended only to a menu that lacks it, so a rerun never adds a second one.
      expect(menus[0]?.post_content.split(SWITCHER_BLOCK)).toHaveLength(2);
    }
  });

  it('points Settings > Privacy at the English data policy page', async () => {
    const [policy] = await wpJson<WpPage[]>(['post', 'list', '--post_type=page', '--name=data-policy', '--fields=ID']);
    expect((await wp(['option', 'get', 'wp_page_for_privacy_policy'])).trim()).toBe(String(policy?.ID));
  });

  it('keeps a privacy page the owner chose, through a rerun', { timeout: 300_000 }, async () => {
    const original = (await wp(['option', 'get', 'wp_page_for_privacy_policy'])).trim();
    const custom = (await wp(['post', 'create', '--post_type=page', '--post_status=publish', '--post_title=Owner policy', '--porcelain'])).trim();
    try {
      await wp(['option', 'update', 'wp_page_for_privacy_policy', custom]);
      await execFileAsync('./setup.sh');
      expect((await wp(['option', 'get', 'wp_page_for_privacy_policy'])).trim()).toBe(custom);
      // A draft (core's own, say) is replaced again.
      await wp(['post', 'update', custom, '--post_status=draft']);
      await execFileAsync('./setup.sh');
      expect((await wp(['option', 'get', 'wp_page_for_privacy_policy'])).trim()).toBe(original);
    } finally {
      await wp(['post', 'delete', custom, '--force']);
      await wp(['option', 'update', 'wp_page_for_privacy_policy', original]);
    }
  });

  it('logs nothing from the plugin', async () => {
    await expect(pluginLogLines()).resolves.toEqual([]);
  });
});

/** The `href`s and menu `url`s setup.sh wrote into one post, in order. */
async function linksOf(postType: string, slug: string): Promise<string[]> {
  const posts = await wpJson<{ post_content: string }[]>(['post', 'list', `--post_type=${postType}`, `--name=${slug}`, '--fields=post_content']);
  const content = posts[0]?.post_content ?? '';
  return [...content.matchAll(/href="([^"]*)"|"url":"([^"]*)"/g)].map(([, href, url]) => href ?? url ?? '');
}

/** Every link setup.sh writes into a menu, keyed by the menu. */
async function menuLinks(): Promise<Record<string, string[]>> {
  return {
    'English menu': await linksOf('wp_navigation', 'primary-navigation'),
    'Spanish menu': await linksOf('wp_navigation', 'navegacion-principal'),
  };
}

/** The paths of a rendered page's button links. The patterns resolve them for the page's language. */
async function buttonPaths(path: string): Promise<string[]> {
  const html = await (await fetch(site(path))).text();
  return [...html.matchAll(/<a class="wp-block-button__link[^"]*" href="([^"]*)"/g)].map(([, href]) => new URL(href ?? '', site('/')).pathname);
}

describe('switching the default language with SITE_LOCALE', () => {
  const runSetup = (locale: string) => execFileAsync('./setup.sh', { env: { ...process.env, SITE_LOCALE: locale } });

  it("rewrites the menu links setup.sh wrote, and each language's buttons point at its own pages", { timeout: 300_000 }, async () => {
    try {
      await runSetup('es_CO');
      expect(await menuLinks()).toEqual({
        'English menu': ['/en/get-a-quote/'],
        'Spanish menu': ['/cotizar/'],
      });
      expect(await buttonPaths('/en/')).toEqual(['/en/get-a-quote/']);
      // pll_home_url() answers the English front page itself, which /en/ redirects to.
      expect(await buttonPaths('/en/thank-you/')).toEqual(['/en/home/']);
      expect(await buttonPaths('/')).toEqual(['/cotizar/']);
      expect(await buttonPaths('/gracias/')).toEqual(['/']);
    } finally {
      await runSetup('en_US');
    }
    expect(await menuLinks()).toEqual({
      'English menu': ['/get-a-quote/'],
      'Spanish menu': ['/es/cotizar/'],
    });
    expect(await buttonPaths('/')).toEqual(['/get-a-quote/']);
    expect(await buttonPaths('/thank-you/')).toEqual(['/']);
    expect(await buttonPaths('/es/')).toEqual(['/es/cotizar/']);
    expect(await buttonPaths('/es/gracias/')).toEqual(['/es/inicio/']);
  });
});

describe('the pinned Polylang download', () => {
  it('refuses a Polylang whose files fail their wordpress.org checksums, removes it, and reinstalls a verified copy on the next run', { timeout: 300_000 }, async () => {
    // Appending to a shipped file is enough to break its checksum.
    await wp(['eval', 'file_put_contents( WP_PLUGIN_DIR . "/polylang/polylang.php", "\\n// tampered\\n", FILE_APPEND );']);
    try {
      const failed = await execFileAsync('./setup.sh').then(
        () => null,
        (error: unknown) => error as { code?: number; stderr?: string },
      );
      expect(failed?.code).toBe(1);
      expect(failed?.stderr).toContain("Polylang's files don't match their wordpress.org checksums");
      await expect(wp(['plugin', 'is-installed', 'polylang'])).rejects.toThrow();
    } finally {
      await execFileAsync('./setup.sh');
    }
    await expect(wp(['plugin', 'verify-checksums', 'polylang'])).resolves.toContain('Success');
    expect((await wp(['plugin', 'get', 'polylang', '--field=status'])).trim()).toBe('active');
  });
});
