import { maskLines } from './headings.ts';
import { findMarkedBlocks } from './marked.ts';
import type { Change } from './marked.ts';
import { BUILTIN, parseOptions } from './options.ts';
import type { TocOptions } from './options.ts';

const LIVE_OPEN = /^\s*(`{3,}|~{3,})\s*(toc|table-of-contents)\s*$/i;
const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s+/;

export interface BlockAt {
  kind: 'live' | 'marked';
  /** First and last line, markers or fences included. */
  start: number;
  end: number;
}

/** The `toc` code block or marked block the line is in, if any. */
export function blockAt(text: string, line: number): BlockAt | null {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = LIVE_OPEN.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    const close = new RegExp(`^\\s*${m[1][0] === '`' ? '`' : '~'}{${m[1].length},}\\s*$`);
    while (end < lines.length && !close.test(lines[end])) end++;
    // A block still being typed has no closing fence: it is not a block yet.
    if (end >= lines.length) continue;
    if (line >= i && line <= end) return { kind: 'live', start: i, end };
    i = end;
  }
  for (const b of findMarkedBlocks(text).blocks) {
    if (line >= b.openLine && line <= b.closeLine) return { kind: 'marked', start: b.openLine, end: b.closeLine };
  }
  return null;
}

/** Line index the cursor can insert after: never inside front matter, code, a TOC or a list. */
function safeLine(lines: string[], line: number): number {
  let l = Math.min(Math.max(line, 0), lines.length - 1);
  const text = lines.join('\n');
  for (let guard = 0; guard < 4; guard++) {
    const mask = maskLines(lines);
    const before = l;
    if (mask[l]) {
      while (l < lines.length - 1 && mask[l + 1]) l++;
      // A fence closes on its own line; front matter likewise.
    }
    const b = blockAt(text, l);
    if (b) l = Math.max(l, b.end);
    if (LIST_LINE.test(lines[l]) || (lines[l].trim() !== '' && /^\s{2,}\S/.test(lines[l]))) {
      while (l < lines.length - 1 && lines[l + 1].trim() !== '' && (LIST_LINE.test(lines[l + 1]) || /^\s+\S/.test(lines[l + 1]))) l++;
    }
    if (l === before) break;
  }
  return l;
}

/** The change that puts `block` near the cursor, with one blank line on each side. */
export function placeBlock(text: string, cursorLine: number, block: string): Change {
  const lines = text.split('\n');
  const l = safeLine(lines, cursorLine);
  const idx = lines[l].trim() === '' && !maskLines(lines)[l] ? l : l + 1;
  const before = idx > 0 && lines[idx - 1].trim() !== '';
  const after = idx < lines.length && lines[idx].trim() !== '';
  if (idx >= lines.length) {
    const last = lines.length - 1;
    const pos = { line: last, ch: lines[last].length };
    return { from: pos, to: pos, text: `${before ? '\n\n' : '\n'}${block}\n` };
  }
  const pos = { line: idx, ch: 0 };
  return { from: pos, to: pos, text: `${before ? '\n' : ''}${block}\n${after ? '\n' : ''}` };
}

const safeDecode = (v: string) => {
  try {
    return decodeURI(v);
  } catch {
    return v;
  }
};

const LINK_ITEM =
  /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\d+(?:\.\d+)*\.?\s+)?(?:\[\[#([^\]]*?)(?:\|[^\]]*)?\]\]|\[[^\]]*\]\(#([^)]*)\))\s*$/;

export interface Adoptable {
  start: number;
  end: number;
  opts: TocOptions;
  /** Targets the list links to, for working out the levels. */
  targets: string[];
}

/** A list of links to headings (or an `insta-toc` block) under the cursor that can become a marked block. */
export function adoptable(text: string, line: number): Adoptable | null {
  const lines = text.split('\n');
  const mask = maskLines(lines);
  const cur = lines[line];
  if (cur === undefined) return null;
  const INSTA = /^\s*`{3,}\s*insta-toc\s*$/;
  let open = line;
  while (open >= 0 && !INSTA.test(lines[open])) {
    if (open < line && /^\s*`{3,}\s*$/.test(lines[open])) open = -1;
    else open--;
  }
  if (open >= 0) {
    let end = open + 1;
    while (end < lines.length && !/^\s*`{3,}\s*$/.test(lines[end])) end++;
    if (end < lines.length && line <= end) {
      return { start: open, end, opts: parseOptions(lines.slice(open + 1, end).join('\n')).opts, targets: [] };
    }
  }
  if (mask[line] || !LINK_ITEM.test(cur)) return null;
  let start = line;
  const inList = (l: string) => l.trim() !== '' && (LIST_LINE.test(l) || /^\s+\S/.test(l));
  while (start > 0 && inList(lines[start - 1])) start--;
  let end = line;
  while (end < lines.length - 1 && inList(lines[end + 1])) end++;
  // Everything in the list must be a link to a heading.
  for (let i = start; i <= end; i++) if (!LINK_ITEM.test(lines[i])) return null;
  const targets: string[] = [];
  for (let i = start; i <= end; i++) {
    const m = LINK_ITEM.exec(lines[i])!;
    const raw = m[2] ?? safeDecode(m[3] ?? '');
    targets.push(raw.split('#').pop() ?? raw);
  }
  const ordered = /^\s*\d+[.)]/.test(lines[start]);
  // An optional bold title line right above, with a blank line between.
  let first = start;
  const t = start >= 2 && lines[start - 1].trim() === '' ? /^\*\*(.+)\*\*$/.exec(lines[start - 2].trim()) : null;
  let title: string | null = null;
  if (t) {
    title = t[1];
    first = start - 2;
  }
  const opts: TocOptions = { ...BUILTIN, style: ordered ? 'numbered' : 'list', format: ordered ? '1.' : BUILTIN.format };
  if (title !== null) opts.title = title;
  else opts.title = '';
  return { start: first, end, opts, targets };
}
