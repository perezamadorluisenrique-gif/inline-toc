import { maskLines, parseHeadings } from './headings.ts';
import type { Heading } from './headings.ts';
import { layout } from './layout.ts';
import { toMarkdown } from './markdown.ts';
import type { MarkdownStyle } from './markdown.ts';
import { CLOSE_MARK, markerLine, parseMarker } from './options.ts';
import type { TocOptions } from './options.ts';

export interface MarkedBlock {
  /** Lines of the opening and closing markers (zero-based). */
  openLine: number;
  closeLine: number;
  opts: TocOptions;
  notes: string[];
}

export interface Pos {
  line: number;
  ch: number;
}

export interface Change {
  from: Pos;
  to: Pos;
  text: string;
}

/** Complete marked blocks outside code, plus the lines of opening markers that never close. */
export function findMarkedBlocks(text: string): { blocks: MarkedBlock[]; orphans: number[] } {
  const lines = text.split('\n');
  const mask = maskLines(lines);
  const blocks: MarkedBlock[] = [];
  const orphans: number[] = [];
  let open: { line: number; opts: TocOptions; notes: string[] } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const line = lines[i].replace(/\r$/, '');
    const marker = parseMarker(line);
    if (marker) {
      if (open) orphans.push(open.line);
      open = { line: i, ...marker };
    } else if (open && line.trim() === CLOSE_MARK) {
      blocks.push({ openLine: open.line, closeLine: i, opts: open.opts, notes: open.notes });
      open = null;
    }
  }
  if (open) orphans.push(open.line);
  return { blocks, orphans };
}

export interface RenderContext {
  stripNumbers: boolean;
  style: MarkdownStyle;
}

/** Markers plus the Markdown between them. */
export function renderMarkedBlock(
  headings: Heading[],
  opts: TocOptions,
  ctx: RenderContext,
  blockLine?: number,
): { text: string; warnings: string[] } {
  const { items } = layout(headings, opts, { stripNumbers: ctx.stripNumbers, blockLine });
  const body = toMarkdown(items, headings, opts, ctx.style);
  return { text: [markerLine(opts), ...(body.text ? [body.text] : []), CLOSE_MARK].join('\n'), warnings: body.warnings };
}

/**
 * One change per block whose text differs. Ranges refer to the original text,
 * which is what `editor.transaction` expects.
 */
export function refreshChanges(
  text: string,
  ctx: RenderContext,
): { changes: Change[]; blocks: number; warnings: string[]; orphans: number[] } {
  const lines = text.split('\n');
  const { blocks, orphans } = findMarkedBlocks(text);
  const headings = parseHeadings(text);
  const changes: Change[] = [];
  const warnings: string[] = [];
  for (const b of blocks) {
    const next = renderMarkedBlock(headings, b.opts, ctx, b.openLine);
    warnings.push(...next.warnings);
    const old = lines.slice(b.openLine, b.closeLine + 1).join('\n').replace(/\r/g, '');
    if (next.text !== old) {
      changes.push({
        from: { line: b.openLine, ch: 0 },
        to: { line: b.closeLine, ch: lines[b.closeLine].length },
        text: next.text,
      });
    }
  }
  return { changes, blocks: blocks.length, warnings: [...new Set(warnings)], orphans };
}

/** Text with the changes applied, for tests and for deciding whether anything differs. */
export function applyChanges(text: string, changes: Change[]): string {
  const lines = text.split('\n');
  const offset = (p: Pos) => lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.ch;
  let out = text;
  for (const c of [...changes].sort((a, b) => offset(b.from) - offset(a.from))) {
    out = out.slice(0, offset(c.from)) + c.text + out.slice(offset(c.to));
  }
  return out;
}
