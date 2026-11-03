import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { clearDebugLog, pluginLogLines, site, wp, wpJson } from '../lib/stack.ts';

const execFileAsync = promisify(execFile);

const SLUGS = ['home', 'get-a-quote', 'thank-you'] as const;

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

  it('activates the default theme', async () => {
    const defaultTheme = (await wp(['eval', 'echo WP_DEFAULT_THEME;'])).trim();
    expect(defaultTheme).toBe('twentytwentyfive');
    const active = await wpJson<{ name: string }[]>(['theme', 'list', '--status=active']);
    expect(active).toHaveLength(1);
    expect(active[0]?.name).toBe(defaultTheme);
  });

  it('creates exactly one published page per slug', async () => {
    for (const slug of SLUGS) {
      const pages = await wpJson<WpPage[]>(['post', 'list', '--post_type=page', `--name=${slug}`, '--fields=ID,post_title,post_status']);
      expect(pages).toHaveLength(1);
      expect(pages[0]?.post_status).toBe('publish');
    }
  });

  it('creates one primary navigation menu that links Home and Get a Quote, never the thank-you page', async () => {
    const menus = await wpJson<WpNavigation[]>([...NAVIGATION_ARGS, '--fields=ID,post_status,post_content']);
    expect(menus).toHaveLength(1);
    expect(menus[0]?.post_status).toBe('publish');
    expect(menus[0]?.post_content).toContain('"url":"/"');
    expect(menus[0]?.post_content).toContain('"url":"/get-a-quote/"');
    expect(menus[0]?.post_content).not.toContain('thank-you');
  });

  it("uses that menu as the theme's header navigation", async () => {
    const html = await (await fetch(site('/'))).text();
    const headerNav = /<nav\b[^>]*\bwp-block-navigation\b[\s\S]*?<\/nav>/.exec(html)?.[0];
    expect(headerNav).toBeDefined();
    expect(headerNav).toContain('/get-a-quote/');
    expect(headerNav).not.toContain('/thank-you/');
  });

  it('sets page_on_front to the home page', async () => {
    const [home] = await wpJson<WpPage[]>(['post', 'list', '--post_type=page', '--name=home', '--fields=ID']);
    const pageOnFront = (await wp(['option', 'get', 'page_on_front'])).trim();
    expect(pageOnFront).toBe(String(home?.ID));
  });

  it('activates the moving-quote plugin', async () => {
    await expect(wp(['plugin', 'is-active', 'moving-quote'])).resolves.toBeDefined();
  });

  it('serves the home and quote pages over HTTP', async () => {
    const home = await fetch(site('/'));
    expect(home.status).toBe(200);
    const quote = await fetch(site('/get-a-quote/'));
    expect(quote.status).toBe(200);
  });

  it('stays idempotent: a second run creates no duplicate pages or menus', async () => {
    await execFileAsync('./setup.sh');
    for (const slug of SLUGS) {
      const pages = await wpJson<WpPage[]>(['post', 'list', '--post_type=page', `--name=${slug}`, '--fields=ID']);
      expect(pages).toHaveLength(1);
    }
    const menus = await wpJson<WpNavigation[]>([...NAVIGATION_ARGS, '--fields=ID']);
    expect(menus).toHaveLength(1);
  });

  it('logs nothing from the plugin', async () => {
    await expect(pluginLogLines()).resolves.toEqual([]);
  });
});
