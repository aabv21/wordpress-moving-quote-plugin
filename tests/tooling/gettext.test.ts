import { describe, expect, it } from 'vitest';
import { entryKey, parsePo, placeholders, withoutCreationDate } from '../../scripts/lib/gettext.ts';
import { sameContent } from '../../scripts/i18n.ts';

const SAMPLE = `# A comment
msgid ""
msgstr ""
"Language: es_CO\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

#. translators: %s: a name
msgid "Hello %s"
msgstr "Hola %s"

msgctxt "lead status"
msgid "New"
msgstr "Nueva"

#, fuzzy
msgid "A \\"quoted\\" "
"continued line"
msgstr ""

msgid "%d room"
msgid_plural "%d rooms"
msgstr[0] "%d habitación"
msgstr[1] "%d habitaciones"

#~ msgid "Gone"
#~ msgstr "Ido"
`;

describe('parsePo', () => {
  const po = parsePo(SAMPLE);

  it('reads the header lines', () => {
    expect(po.headers).toEqual({ Language: 'es_CO', 'Plural-Forms': 'nplurals=2; plural=(n != 1);' });
    expect(po.headerFuzzy).toBe(false);
  });

  it('reads context, continuation lines, escapes, flags, and plural forms, and drops obsolete entries', () => {
    expect(po.entries).toEqual([
      { msgctxt: null, msgid: 'Hello %s', msgidPlural: null, msgstr: ['Hola %s'], flags: [] },
      { msgctxt: 'lead status', msgid: 'New', msgidPlural: null, msgstr: ['Nueva'], flags: [] },
      { msgctxt: null, msgid: 'A "quoted" continued line', msgidPlural: null, msgstr: [''], flags: ['fuzzy'] },
      { msgctxt: null, msgid: '%d room', msgidPlural: '%d rooms', msgstr: ['%d habitación', '%d habitaciones'], flags: [] },
    ]);
  });

  it('keys an entry by its context and msgid together', () => {
    expect(entryKey({ msgctxt: null, msgid: 'New' })).not.toBe(entryKey({ msgctxt: 'lead status', msgid: 'New' }));
  });
});

describe('placeholders', () => {
  it('normalizes numbered and unnumbered placeholders, so a translation may reorder numbered ones', () => {
    expect(placeholders('%1$s (%2$d attempts)')).toEqual(['1$s', '2$d']);
    expect(placeholders('(%2$d) %1$s')).toEqual(['1$s', '2$d']);
    expect(placeholders('%s km')).toEqual(['1$s']);
  });

  it('ignores a literal percent sign', () => {
    expect(placeholders('100%% sure, 50% off')).toEqual([]);
  });

  it('tells a missing or changed placeholder apart', () => {
    expect(placeholders('%d rooms')).not.toEqual(placeholders('rooms'));
    expect(placeholders('%d rooms')).not.toEqual(placeholders('%s rooms'));
  });
});

describe('comparing a regenerated file with the committed one', () => {
  const pot = (date: string, extra = ''): Buffer => Buffer.from(`msgid ""\nmsgstr ""\n"POT-Creation-Date: ${date}\\n"\n"X-Domain: moving-quote\\n"\n${extra}`);

  it('ignores only the POT-Creation-Date line of a .pot', () => {
    expect(withoutCreationDate(pot('2026-11-03T06:00:00+00:00').toString())).not.toContain('POT-Creation-Date');
    expect(sameContent('moving-quote.pot', pot('2026-11-03T06:00:00+00:00'), pot('2027-01-01T00:00:00+00:00'))).toBe(true);
    expect(sameContent('moving-quote.pot', pot('2026-11-03T06:00:00+00:00', 'msgid "New"\n'), pot('2026-11-03T06:00:00+00:00'))).toBe(false);
  });

  it('compares a compiled file byte for byte, and a missing one as stale', () => {
    expect(sameContent('moving-quote-es_CO.mo', Buffer.from([1, 2]), Buffer.from([1, 2]))).toBe(true);
    expect(sameContent('moving-quote-es_CO.mo', Buffer.from([1, 2]), Buffer.from([1, 3]))).toBe(false);
    expect(sameContent('moving-quote-es_CO.l10n.php', Buffer.from('x'), null)).toBe(false);
  });
});
