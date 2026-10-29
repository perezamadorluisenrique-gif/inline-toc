// Pure logic: no `obsidian` import, so tests/ can run it under plain Node.

export interface Heading {
  level: number;
  /** Heading text as written, without the leading `#`s. */
  raw: string;
  /** Zero-based line in the note. */
  line: number;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)+/;
const LIST_PREFIX = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/;

/**
 * Marks the lines that never hold headings or markers: front matter, fenced
 * code (fences included), `$$` maths and `%%` comments.
 */
export function maskLines(lines: string[]): boolean[] {
  const mask = new Array<boolean>(lines.length).fill(false);
  let i = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && /^(---|\.\.\.)\s*$/.test(l.replace(/\r$/, '')));
    if (end > 0) {
      for (; i <= end; i++) mask[i] = true;
    }
  }
  let fence: string | null = null;
  let math = false;
  let comment = false;
  for (; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (fence) {
      mask[i] = true;
      const m = FENCE.exec(line);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      continue;
    }
    if (math) {
      mask[i] = true;
      if (line.includes('$$')) math = false;
      continue;
    }
    if (comment) {
      mask[i] = true;
      if (line.includes('%%')) comment = false;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      fence = f[1];
      mask[i] = true;
      continue;
    }
    const t = line.trim();
    if (t.startsWith('$$')) {
      mask[i] = true;
      if (t.indexOf('$$', 2) < 0) math = true;
      continue;
    }
    const pct = (line.match(/%%/g) ?? []).length;
    if (pct % 2 === 1) {
      mask[i] = true;
      comment = true;
      continue;
    }
    if (pct > 0 && t.startsWith('%%') && t.endsWith('%%')) mask[i] = true;
  }
  return mask;
}

/** Headings of a note, skipping front matter, code, maths and comments. */
export function parseHeadings(text: string): Heading[] {
  const lines = text.split('\n');
  const mask = maskLines(lines);
  const out: Heading[] = [];
  let htmlComment = false;
  let prev = ''; // paragraph line right above, for setext headings
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (mask[i]) {
      prev = '';
      continue;
    }
    if (htmlComment) {
      if (line.includes('-->')) htmlComment = false;
      prev = '';
      continue;
    }
    if (/^\s*<!--/.test(line) && !line.includes('-->')) {
      htmlComment = true;
      prev = '';
      continue;
    }
    if (/^\s*<!--.*-->\s*$/.test(line)) {
      prev = '';
      continue;
    }
    // Obsidian's index does not treat a heading inside a callout or list item as a heading.
    const a = ATX.exec(line);
    if (a) {
      out.push({ level: a[1].length, raw: (a[2] ?? '').trim(), line: i });
      prev = '';
      continue;
    }
    const s = SETEXT.exec(line);
    if (
      s &&
      prev.trim() !== '' &&
      !LIST_PREFIX.test(prev) &&
      !QUOTE_PREFIX.test(prev) &&
      !/^\s*\|/.test(prev) &&
      !/^\s*<!--/.test(prev) &&
      !ATX.test(prev)
    ) {
      out.push({ level: s[1][0] === '=' ? 1 : 2, raw: prev.trim(), line: i - 1 });
      prev = '';
      continue;
    }
    prev = line;
  }
  return out.filter((h) => h.raw !== '');
}

/** Heading text as a reader sees it: no emphasis marks, link syntax, comments or footnotes. */
export function displayText(raw: string): string {
  return raw
    .replace(/%%.*?%%/g, '')
    .replace(/\[\^[^\]]*\]/g, '')
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]*)\]\]/g, (_, t: string) => (t.includes('#') ? t.slice(t.lastIndexOf('#') + 1) || t : t))
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\*{1,3}([^\s*](?:[^*]*[^\s*])?)\*{1,3}/g, '$1')
    .replace(/(^|[^\w])(__?)([^_]+)\2(?![\w])/g, '$1$3')
    .replace(/(==|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What `[[#...]]` must contain to reach the heading. Obsidian matches against
 * the heading as written with a few characters removed, not against what the
 * reader sees; the e2e spec opens every generated link to confirm this.
 */
export function linkTarget(raw: string): string {
  return raw
    .replace(/%%.*?%%/g, '')
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$1 $2')
    .replace(/!?\[\[([^\]]*)\]\]/g, '$1')
    .replace(/[#|^:[\]\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NUMBER_PREFIX = /^(?:\d+(?:\.\d+)+[.)]?|\d+[.)]|[IVXLC]+[.)])[ \t]+(?=\S)/;

/** Whether a heading starts with its own section number. */
export function hasNumberPrefix(text: string): boolean {
  return NUMBER_PREFIX.test(text);
}

export function stripNumber(text: string): string {
  return text.replace(NUMBER_PREFIX, '');
}
