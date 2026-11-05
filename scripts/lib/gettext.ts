/** The header (empty `msgid`, no context) is never one of these. */
export interface PoEntry {
  msgctxt: string | null;
  msgid: string;
  msgidPlural: string | null;
  /** `msgstr`, or `msgstr[0]`, `msgstr[1]`, … for a plural entry, in index order. */
  msgstr: string[];
  flags: string[];
}

export interface PoFile {
  headers: Record<string, string>;
  /** Some tools mark a whole new catalog fuzzy this way. */
  headerFuzzy: boolean;
  entries: PoEntry[];
}

function unescape(literal: string): string {
  return literal.replace(/\\(.)/g, (_match, char: string) => {
    switch (char) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      default:
        return char;
    }
  });
}

function quoted(line: string): string {
  const match = /"(.*)"\s*$/.exec(line);
  if (!match) throw new Error(`not a quoted .po line: ${line}`);
  return unescape(match[1] ?? '');
}

interface Draft {
  msgctxt: string | null;
  msgid: string | null;
  msgidPlural: string | null;
  msgstr: Map<number, string>;
  flags: string[];
  obsolete: boolean;
}

function emptyDraft(): Draft {
  return { msgctxt: null, msgid: null, msgidPlural: null, msgstr: new Map(), flags: [], obsolete: false };
}

/**
 * Drops obsolete (`#~`) entries, as gettext does. Supports only what WP-CLI and a hand-written
 * catalog produce: `msgctxt`, `msgid`, `msgid_plural`, `msgstr`, `msgstr[n]`, with continuations.
 */
export function parsePo(text: string): PoFile {
  const drafts: Draft[] = [];
  let draft = emptyDraft();
  let target: { set: (value: string) => void; get: () => string } | null = null;

  const flush = (): void => {
    if (draft.msgid !== null && !draft.obsolete) drafts.push(draft);
    draft = emptyDraft();
    target = null;
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('#~')) {
      draft.obsolete = true;
      continue;
    }
    if (line.startsWith('#,')) {
      draft.flags.push(
        ...line
          .slice(2)
          .split(',')
          .map((flag) => flag.trim())
          .filter(Boolean),
      );
      continue;
    }
    if (line.startsWith('#')) continue;

    if (line.startsWith('"')) {
      if (!target) throw new Error(`a continuation line with no keyword before it: ${line}`);
      const current = target;
      current.set(current.get() + quoted(line));
      continue;
    }

    // A keyword after a completed msgstr with no blank line between starts a new entry.
    if ((line.startsWith('msgctxt') || line.startsWith('msgid ')) && draft.msgstr.size > 0) flush();

    const current = draft;
    const plural = /^msgstr\[(\d+)\]/.exec(line);
    if (line.startsWith('msgctxt')) {
      current.msgctxt = quoted(line);
      target = { set: (value) => (current.msgctxt = value), get: () => current.msgctxt ?? '' };
    } else if (line.startsWith('msgid_plural')) {
      current.msgidPlural = quoted(line);
      target = { set: (value) => (current.msgidPlural = value), get: () => current.msgidPlural ?? '' };
    } else if (line.startsWith('msgid')) {
      current.msgid = quoted(line);
      target = { set: (value) => (current.msgid = value), get: () => current.msgid ?? '' };
    } else if (plural) {
      const index = Number(plural[1]);
      current.msgstr.set(index, quoted(line));
      target = { set: (value) => current.msgstr.set(index, value), get: () => current.msgstr.get(index) ?? '' };
    } else if (line.startsWith('msgstr')) {
      current.msgstr.set(0, quoted(line));
      target = { set: (value) => current.msgstr.set(0, value), get: () => current.msgstr.get(0) ?? '' };
    } else {
      throw new Error(`unrecognized .po line: ${line}`);
    }
  }
  flush();

  const headerDraft = drafts.find((entry) => entry.msgid === '' && entry.msgctxt === null);
  const headers: Record<string, string> = {};
  for (const headerLine of (headerDraft?.msgstr.get(0) ?? '').split('\n')) {
    const colon = headerLine.indexOf(':');
    if (colon > 0) headers[headerLine.slice(0, colon).trim()] = headerLine.slice(colon + 1).trim();
  }

  const entries = drafts
    .filter((entry) => entry !== headerDraft)
    .map((entry) => ({
      msgctxt: entry.msgctxt,
      msgid: entry.msgid ?? '',
      msgidPlural: entry.msgidPlural,
      msgstr: [...entry.msgstr.entries()].sort(([a], [b]) => a - b).map(([, value]) => value),
      flags: entry.flags,
    }));

  return { headers, headerFuzzy: headerDraft?.flags.includes('fuzzy') ?? false, entries };
}

/** Gettext treats one `msgid` under two contexts as two messages. */
export function entryKey(entry: Pick<PoEntry, 'msgctxt' | 'msgid'>): string {
  return entry.msgctxt === null ? entry.msgid : `${entry.msgctxt}\u0004${entry.msgid}`;
}

/**
 * Normalized to sorted `<position>$<type>` entries, so a translation may reorder them. An
 * unnumbered one takes the next position.
 */
export function placeholders(text: string): string[] {
  const found: string[] = [];
  let next = 1;
  for (let at = text.indexOf('%'); at !== -1; at = text.indexOf('%', at + 1)) {
    if (text.charAt(at + 1) === '%') {
      at += 1; // `%%` is a literal percent sign
      continue;
    }
    let digitsEnd = at + 1;
    while (digitsEnd < text.length && /\d/.test(text.charAt(digitsEnd))) digitsEnd++;
    const numbered = digitsEnd > at + 1 && text.charAt(digitsEnd) === '$';
    const typeAt = numbered ? digitsEnd + 1 : at + 1;
    const type = text.charAt(typeAt);
    if (type !== 's' && type !== 'd') continue;
    const position = numbered ? Number(text.slice(at + 1, digitsEnd)) : next++;
    found.push(`${String(position)}$${type}`);
  }
  return found.sort();
}

/** make-pot stamps `POT-Creation-Date` with the current time; everything else is stable. */
export function withoutCreationDate(pot: string): string {
  return pot
    .split('\n')
    .filter((line) => !line.startsWith('"POT-Creation-Date:'))
    .join('\n');
}
