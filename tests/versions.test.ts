import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the plugin version', () => {
  it('the plugin header Version, Plugin::VERSION and the plugin\'s composer.json version agree', () => {
    const header = /^ \* Version: (\S+)$/m.exec(readFileSync('plugin/moving-quote/moving-quote.php', 'utf8'))?.[1];
    const constant = /public const VERSION = '([^']+)';/.exec(readFileSync('plugin/moving-quote/src/Plugin.php', 'utf8'))?.[1];
    const composer = (JSON.parse(readFileSync('plugin/moving-quote/composer.json', 'utf8')) as { version?: string }).version;
    expect(header).toMatch(/^\d+\.\d+\.\d+$/);
    expect(constant).toBe(header);
    expect(composer).toBe(header);
  });
});
