import { displayText, hasNumberPrefix, linkTarget, stripNumber } from './headings.ts';
import type { Heading } from './headings.ts';
import { compilePattern } from './options.ts';
import type { TocOptions } from './options.ts';

export interface TocItem {
  /** Nesting depth from 0, after collapsing skipped levels. */
  depth: number;
  /** "1", "1.2", "1.2.1". */
  number: string;
  /** What the reader sees. */
  text: string;
  /** What `[[#...]]` has to say to reach the heading. */
  target: string;
  line: number;
  level: number;
  /** Position in the note's full heading list. */
  index: number;
}

export interface LayoutContext {
  /** Strip "1.2 " prefixes when the list is numbered. */
  stripNumbers?: boolean;
  /** Line of the block itself, for `scope: section`. */
  blockLine?: number;
}

/** Turns headings into the items to show, with depths and section numbers. */
export function layout(headings: Heading[], opts: TocOptions, ctx: LayoutContext = {}): { items: TocItem[]; notes: string[] } {
  const notes: string[] = [];
  let candidates = headings.map((h, index) => ({ h, index }));

  if (opts.scope === 'section' && ctx.blockLine !== undefined) {
    const host = candidates.filter((c) => c.h.line < ctx.blockLine!).pop();
    if (host) {
      const after = candidates.filter((c) => c.h.line > host.h.line);
      const stop = after.findIndex((c) => c.h.level <= host.h.level);
      candidates = stop < 0 ? after : after.slice(0, stop);
    }
  }

  const ones = headings.filter((h) => h.level === 1);
  const dropTitle =
    opts.skipH1 === 'yes' ||
    (opts.skipH1 === 'auto' && ones.length === 1 && headings[0]?.level === 1);
  if (dropTitle) candidates = candidates.filter((c) => c.h.level !== 1);

  candidates = candidates.filter((c) => c.h.level >= opts.min && c.h.level <= opts.max);

  const inc = compilePattern(opts.include);
  const exc = compilePattern(opts.exclude);
  for (const p of [inc, exc]) if (p && 'error' in p) notes.push(p.error);
  if (inc && 're' in inc) candidates = candidates.filter((c) => inc.re.test(displayText(c.h.raw)));
  else if (exc && 're' in exc) candidates = candidates.filter((c) => !exc.re.test(displayText(c.h.raw)));

  const strip =
    !!ctx.stripNumbers &&
    opts.style === 'numbered' &&
    candidates.length > 0 &&
    candidates.filter((c) => hasNumberPrefix(displayText(c.h.raw))).length * 2 >= candidates.length;

  const items: TocItem[] = [];
  const stack: number[] = [];
  const counters: number[] = [];
  for (const { h, index } of candidates) {
    while (stack.length && stack[stack.length - 1] >= h.level) stack.pop();
    const depth = stack.length;
    stack.push(h.level);
    counters.length = depth + 1;
    counters[depth] = (counters[depth] ?? 0) + 1;
    for (let d = 0; d < depth; d++) counters[d] ??= 1;
    const text = displayText(h.raw);
    items.push({
      depth,
      number: counters.slice(0, depth + 1).join('.'),
      text: strip ? stripNumber(text) : text,
      target: linkTarget(h.raw),
      line: h.line,
      level: h.level,
      index,
    });
  }
  return { items, notes };
}

/** Changes whenever what a block shows would change. */
export function signature(items: TocItem[], opts: TocOptions): string {
  return JSON.stringify([opts, items.map((i) => [i.depth, i.number, i.text, i.line])]);
}

/** Section number as written for a style: "1.2", "1.2." or "1.". */
export function numberLabel(item: TocItem, opts: Pick<TocOptions, 'format'>): string {
  if (opts.format === '1.') return '1.';
  return opts.format === '1.2.' ? `${item.number}.` : item.number;
}
