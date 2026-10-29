import { linkTarget } from './headings.ts';
import type { Heading } from './headings.ts';
import { numberLabel } from './layout.ts';
import type { TocItem } from './layout.ts';
import type { Settings, TocOptions } from './options.ts';

export interface MarkdownStyle {
  linkFormat: Settings['linkFormat'];
  titleLine: Settings['titleLine'];
}

export const DEFAULT_MARKDOWN: MarkdownStyle = { linkFormat: 'wiki', titleLine: 'bold' };

/** For every heading, the chain of link targets from the top of the note down to it. */
function pathsOf(headings: Heading[]): string[][] {
  const stack: { level: number; target: string }[] = [];
  return headings.map((h) => {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push({ level: h.level, target: linkTarget(h.raw) });
    return stack.map((s) => s.target);
  });
}

/**
 * Shortest `A#B#C` path that points at one heading only, or null when two
 * identical siblings make that impossible.
 */
function uniquePath(paths: string[][], i: number): string | null {
  const mine = paths[i];
  for (let k = 1; k <= mine.length; k++) {
    const suffix = mine.slice(-k).join('#');
    const hits = paths.filter((p) => p.length >= k && p.slice(-k).join('#') === suffix).length;
    if (hits === 1) return suffix;
  }
  return null;
}

const safeAlias = (t: string) => t.replace(/\|/g, '-').replace(/\]\]/g, '] ]').trim();

function link(item: TocItem, path: string | null, style: MarkdownStyle, links: boolean): string {
  const text = safeAlias(item.text);
  if (!links || !item.target) return text;
  const target = path ?? item.target;
  if (style.linkFormat === 'markdown') {
    const url = encodeURI(target.replace(/#/g, '#')).replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `[${item.text.replace(/([[\]])/g, '\\$1')}](#${url})`;
  }
  return target === text ? `[[#${target}]]` : `[[#${target}|${text}]]`;
}

/** Plain Markdown for a table of contents, so it works in Publish and exports. */
export function toMarkdown(
  items: TocItem[],
  all: Heading[],
  opts: TocOptions,
  style: MarkdownStyle = DEFAULT_MARKDOWN,
): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const out: string[] = [];
  if (opts.title && style.titleLine !== 'none') out.push(style.titleLine === 'bold' ? `**${opts.title}**` : opts.title, '');
  if (!items.length) return { text: out.join('\n').replace(/\s+$/, ''), warnings };

  const paths = pathsOf(all);
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(p[p.length - 1], (counts.get(p[p.length - 1]) ?? 0) + 1);
  let ambiguous = 0;
  const labelOf = (it: TocItem): string => {
    let path: string | null = null;
    if (it.target && (counts.get(it.target) ?? 0) > 1) {
      path = uniquePath(paths, it.index);
      if (path === null) ambiguous++;
    }
    return link(it, path, style, opts.links);
  };

  if (opts.style === 'inline') {
    out.push(items.filter((it) => it.depth === 0).map(labelOf).join(' · '));
  } else {
    for (const it of items) {
      const label = labelOf(it);
      if (opts.style === 'numbered' && opts.format === '1.') {
        out.push(`${'   '.repeat(it.depth)}1. ${label}`);
      } else if (opts.style === 'numbered') {
        // "1." right after "- " would start an ordered list, so escape the dot.
        const n = numberLabel(it, opts).replace(/^(\d+)\.$/, '$1\\.');
        out.push(`${'  '.repeat(it.depth)}- ${n} ${label}`);
      } else out.push(`${'  '.repeat(it.depth)}- ${label}`);
    }
  }
  if (ambiguous) warnings.push(`${ambiguous} heading${ambiguous === 1 ? '' : 's'} share a name; links go to the first.`);
  return { text: out.join('\n'), warnings };
}
