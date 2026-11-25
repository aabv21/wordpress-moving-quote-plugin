import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entryKey, parsePo, placeholders, type PoEntry } from '../scripts/lib/gettext.ts';
import { TEXT_DOMAINS } from '../scripts/i18n.ts';

/** The HTML tags a message carries, in order, so a translation can't drop or add markup. */
function tags(text: string): string[] {
  return [...text.matchAll(/<\/?[a-z]+/g)].map((match) => match[0]);
}

/** `msgid` for the singular form, `msgid_plural` for every other. */
function sourceFor(entry: PoEntry, form: number): string {
  return form === 0 || entry.msgidPlural === null ? entry.msgid : entry.msgidPlural;
}

/** As `wp i18n make-php` writes each translation into `.l10n.php`. */
function phpSingleQuoted(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
}

it('covers the plugin and the theme', () => {
  expect(TEXT_DOMAINS.map((domain) => domain.domain)).toEqual(['moving-quote', 'chivabox']);
});

describe.each(TEXT_DOMAINS)('the $domain text domain', ({ domain, languagesDir, potFile, poPrefix }) => {
  const pot = parsePo(readFileSync(`${languagesDir}/${potFile}`, 'utf8'));
  const catalogs = readdirSync(languagesDir).filter((name) => name.endsWith('.po'));

  it('has a translation template for its own domain', () => {
    expect(pot.entries.length).toBeGreaterThan(10);
    expect(pot.headers['X-Domain']).toBe(domain);
  });

  it('ships a Spanish (Colombia) catalog', () => {
    expect(catalogs).toContain(`${poPrefix}es_CO.po`);
  });

  describe.each(catalogs)('%s', (catalogName) => {
    const po = parsePo(readFileSync(`${languagesDir}/${catalogName}`, 'utf8'));
    const potEntries = new Map(pot.entries.map((entry) => [entryKey(entry), entry]));
    const poEntries = new Map(po.entries.map((entry) => [entryKey(entry), entry]));
    const nplurals = Number(/nplurals=(\d+)/.exec(po.headers['Plural-Forms'] ?? '')?.[1]);
    const base = catalogName.replace(/\.po$/, '');

    it('declares its language and plural forms, and is not fuzzy as a whole', () => {
      expect(po.headers.Language).toBe(base.slice(poPrefix.length));
      expect(nplurals).toBeGreaterThanOrEqual(1);
      expect(po.headerFuzzy).toBe(false);
    });

    it('has every template message, and nothing the template no longer has', () => {
      expect([...poEntries.keys()].sort()).toEqual([...potEntries.keys()].sort());
    });

    it('translates every message, with no fuzzy entry', () => {
      const untranslated: string[] = [];
      for (const entry of po.entries) {
        const expectedForms = entry.msgidPlural === null ? 1 : nplurals;
        if (entry.flags.includes('fuzzy') || entry.msgstr.length !== expectedForms || entry.msgstr.some((form) => form.trim() === '')) {
          untranslated.push(entryKey(entry));
        }
      }
      expect(untranslated).toEqual([]);
    });

    it('keeps every message’s plural source, placeholders, and markup', () => {
      const mismatched: string[] = [];
      for (const entry of po.entries) {
        if (entry.msgidPlural !== (potEntries.get(entryKey(entry))?.msgidPlural ?? null)) mismatched.push(`${entryKey(entry)}: msgid_plural`);
        entry.msgstr.forEach((form, index) => {
          const source = sourceFor(entry, index);
          if (JSON.stringify(placeholders(form)) !== JSON.stringify(placeholders(source))) mismatched.push(`${entryKey(entry)}[${String(index)}]: placeholders`);
          if (JSON.stringify(tags(form)) !== JSON.stringify(tags(source))) mismatched.push(`${entryKey(entry)}[${String(index)}]: markup`);
        });
      }
      expect(mismatched).toEqual([]);
    });

    it('is compiled into the committed .l10n.php, which carries every translation', () => {
      const php = readFileSync(`${languagesDir}/${base}.l10n.php`, 'utf8');
      expect(php).toContain(`'domain'=>'${domain}'`);
      const missing = po.entries.flatMap((entry) => entry.msgstr).filter((form) => !php.includes(`'${phpSingleQuoted(form)}'`));
      expect(missing).toEqual([]);
    });

    it('is compiled into the committed .mo, which holds every message plus the header', () => {
      const mo = readFileSync(`${languagesDir}/${base}.mo`);
      expect(mo.readUInt32LE(0)).toBe(0x950412de);
      expect(mo.readUInt32LE(8)).toBe(po.entries.length + 1);
    });
  });
});
