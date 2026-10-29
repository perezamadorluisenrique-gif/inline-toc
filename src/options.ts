// Options of a table of contents: one parser for `toc` code blocks and for
// the `<!-- inline-toc ... -->` marker comment. No `obsidian` import.

export type Style = 'list' | 'numbered' | 'inline';
export type NumberFormat = '1.2' | '1.2.' | '1.';
export type Scope = 'note' | 'section';
export type SkipH1 = 'auto' | 'yes' | 'no';

export interface TocOptions {
  min: number;
  max: number;
  style: Style;
  format: NumberFormat;
  /** Empty: no header. */
  title: string;
  /** `/re/flags` or plain text; empty: off. */
  include: string;
  exclude: string;
  links: boolean;
  hideWhenEmpty: boolean;
  collapsed: boolean;
  scope: Scope;
  skipH1: SkipH1;
}

export interface Settings {
  title: string;
  min: number;
  max: number;
  style: Style;
  format: NumberFormat;
  skipH1: SkipH1;
  exclude: string;
  stripNumbers: boolean;
  highlight: boolean;
  startCollapsed: boolean;
  framed: boolean;
  autoRefresh: boolean;
  linkFormat: 'wiki' | 'markdown';
  titleLine: 'bold' | 'plain' | 'none';
  insertFormat: 'live' | 'markdown';
}

export const BUILTIN: TocOptions = {
  min: 1,
  max: 6,
  style: 'list',
  format: '1.2',
  title: 'Contents',
  include: '',
  exclude: '',
  links: true,
  hideWhenEmpty: false,
  collapsed: false,
  scope: 'note',
  skipH1: 'auto',
};

export const DEFAULT_SETTINGS: Settings = {
  title: BUILTIN.title,
  min: BUILTIN.min,
  max: BUILTIN.max,
  style: BUILTIN.style,
  format: BUILTIN.format,
  skipH1: BUILTIN.skipH1,
  exclude: '',
  stripNumbers: true,
  highlight: true,
  startCollapsed: false,
  framed: true,
  autoRefresh: true,
  linkFormat: 'wiki',
  titleLine: 'bold',
  insertFormat: 'live',
};

export function optionsFromSettings(s: Settings): TocOptions {
  return {
    ...BUILTIN,
    min: s.min,
    max: Math.max(s.min, s.max),
    style: s.style,
    format: s.format,
    title: s.title,
    exclude: s.exclude,
    collapsed: s.startCollapsed,
    skipH1: s.skipH1,
  };
}

export const OPEN_MARK = '<!-- inline-toc';
export const CLOSE_MARK = '<!-- /inline-toc -->';

const ALIASES: Record<string, string> = {
  min: 'min', minlevel: 'min', mindepth: 'min', from: 'min',
  max: 'max', maxlevel: 'max', maxdepth: 'max', to: 'max',
  levels: 'levels',
  style: 'style',
  numbered: 'numbered', ordered: 'numbered',
  format: 'format', numbering: 'format',
  title: 'title',
  include: 'include',
  exclude: 'exclude',
  links: 'links', includelinks: 'links',
  hidewhenempty: 'hideWhenEmpty',
  collapsed: 'collapsed', fold: 'collapsed', folded: 'collapsed',
  scope: 'scope',
  skiph1: 'skipH1', skiptitle: 'skipH1',
  debuginconsole: 'silent',
};

const STYLES: Record<string, Style> = {
  list: 'list', bullets: 'list', nestedlist: 'list',
  numbered: 'numbered', numbers: 'numbered', nestedorderedlist: 'numbered',
  inline: 'inline', inlinefirstlevel: 'inline',
};

const normKey = (k: string) => k.toLowerCase().replace(/[-_]/g, '');

function parseBool(v: string): boolean | null {
  if (/^(true|yes|on|1)$/i.test(v)) return true;
  if (/^(false|no|off|0)$/i.test(v)) return false;
  return null;
}

type Pair = { key: string; value: string | null };

function unquote(v: string): string {
  const m = /^(["'])(.*)\1$/.exec(v);
  return (m ? m[2] : v).replace(/&quot;/g, '"');
}

/** Block body: one option per line, `key: value`, `key = value`, `key value` or a bare `key`. */
function blockPairs(source: string): Pair[] {
  const out: Pair[] = [];
  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const m = /^([A-Za-z][\w-]*)(?:\s*[:=]\s*|\s+)(.*)$/.exec(line);
    if (!m) {
      out.push({ key: line, value: null });
      continue;
    }
    let value = m[2].trim();
    const quoted = /^(["'])(.*?)\1/.exec(value);
    if (quoted) value = quoted[2];
    else if (value.startsWith('/')) {
      const re = /^\/.+\/[a-z]*/i.exec(value);
      if (re) value = re[0];
    } else value = value.replace(/\s+#(\s.*)?$/, '').trim();
    out.push({ key: m[1], value });
  }
  return out;
}

/** Marker attributes: `key=value` pairs and bare words, values with spaces quoted. */
function markerPairs(attrs: string): Pair[] {
  const out: Pair[] = [];
  const re = /([A-Za-z][\w-]*)(?:=("[^"]*"|'[^']*'|\S*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) out.push({ key: m[1], value: m[2] === undefined ? null : unquote(m[2]) });
  return out;
}

function apply(pairs: Pair[], defaults: TocOptions): { opts: TocOptions; notes: string[] } {
  const o: TocOptions = { ...defaults };
  const notes: string[] = [];
  const bad = (k: string, why: string) => notes.push(`${k} ${why}`);
  for (const { key, value } of pairs) {
    const canon = ALIASES[normKey(key)];
    if (!canon) {
      notes.push(`Ignored: ${key}`);
      continue;
    }
    if (canon === 'silent') continue;
    const bool = (): boolean | null => (value === null ? true : parseBool(value));
    if (canon === 'min' || canon === 'max') {
      const n = Number(value);
      if (value === null || !Number.isInteger(n) || n < 0 || n > 6) bad(key, 'must be 0 to 6');
      else o[canon] = n === 0 ? (canon === 'min' ? 1 : 6) : n;
    } else if (canon === 'levels') {
      const m = /^(\d)\s*(?:-|\.\.|–)\s*(\d)$/.exec(value ?? '') ?? /^(\d)$/.exec(value ?? '');
      if (!m) bad(key, 'must look like 2-4');
      else {
        o.min = Number(m[1]);
        o.max = Number(m[2] ?? m[1]);
      }
    } else if (canon === 'style') {
      const s = STYLES[normKey(value ?? '')];
      if (!s) bad(key, 'must be list, numbered or inline');
      else {
        o.style = s;
        if (normKey(value ?? '') === 'nestedorderedlist') o.format = '1.';
      }
    } else if (canon === 'numbered') {
      const b = bool();
      if (b === null) bad(key, 'must be true or false');
      else o.style = b ? 'numbered' : 'list';
    } else if (canon === 'format') {
      if (value === '1.2' || value === '1.2.' || value === '1.') o.format = value;
      else bad(key, 'must be 1.2, 1.2. or 1.');
    } else if (canon === 'title') o.title = value ?? '';
    else if (canon === 'include' || canon === 'exclude') o[canon] = value ?? '';
    else if (canon === 'scope') {
      if (value === 'note' || value === 'section') o.scope = value;
      else bad(key, 'must be note or section');
    } else if (canon === 'skipH1') {
      const b = value === 'auto' ? 'auto' : bool();
      if (b === null) bad(key, 'must be auto, yes or no');
      else o.skipH1 = b === 'auto' ? 'auto' : b ? 'yes' : 'no';
    } else {
      const b = bool();
      if (b === null) bad(key, 'must be true or false');
      else (o as unknown as Record<string, boolean>)[canon] = b;
    }
  }
  if (o.max < o.min) o.max = o.min;
  return { opts: o, notes };
}

export function parseOptions(source: string, defaults: TocOptions = BUILTIN) {
  return apply(blockPairs(source), defaults);
}

/** Reads `<!-- inline-toc min=2 numbered title="Contents" -->`; null if the line is not an opening marker. */
export function parseMarker(line: string): { opts: TocOptions; notes: string[] } | null {
  const m = /^\s*<!--\s*inline-toc\b(.*?)-->\s*$/.exec(line);
  return m ? apply(markerPairs(m[1]), BUILTIN) : null;
}

/** Writes only the keys that differ from the built-in defaults, so a note means the same in every vault. */
export function markerLine(opts: TocOptions): string {
  const parts = [OPEN_MARK];
  const q = (v: string) => `"${v.replace(/"/g, '&quot;')}"`;
  if (opts.min !== BUILTIN.min) parts.push(`min=${opts.min}`);
  if (opts.max !== BUILTIN.max) parts.push(`max=${opts.max}`);
  if (opts.style !== BUILTIN.style) parts.push(`style=${opts.style}`);
  if (opts.format !== BUILTIN.format) parts.push(`format=${q(opts.format)}`);
  if (opts.title !== BUILTIN.title) parts.push(`title=${q(opts.title)}`);
  if (opts.include) parts.push(`include=${q(opts.include)}`);
  if (opts.exclude) parts.push(`exclude=${q(opts.exclude)}`);
  if (!opts.links) parts.push('links=false');
  if (opts.scope !== BUILTIN.scope) parts.push(`scope=${opts.scope}`);
  if (opts.skipH1 !== BUILTIN.skipH1) parts.push(`skipH1=${opts.skipH1}`);
  if (opts.collapsed) parts.push('collapsed');
  if (opts.hideWhenEmpty) parts.push('hideWhenEmpty');
  return `${parts.join(' ')} -->`;
}

/** The body of a live block that says the same as `opts`, writing the keys that differ from `base`. */
export function blockBody(opts: TocOptions, base: TocOptions = BUILTIN): string {
  const lines: string[] = [];
  if (opts.min !== base.min) lines.push(`min: ${opts.min}`);
  if (opts.max !== base.max) lines.push(`max: ${opts.max}`);
  if (opts.style !== base.style) lines.push(`style: ${opts.style}`);
  if (opts.format !== base.format) lines.push(`format: ${opts.format}`);
  if (opts.title !== base.title) lines.push(`title: "${opts.title}"`);
  if (opts.include !== base.include) lines.push(`include: "${opts.include}"`);
  if (opts.exclude !== base.exclude) lines.push(`exclude: "${opts.exclude}"`);
  if (opts.links !== base.links) lines.push(`links: ${opts.links}`);
  if (opts.scope !== base.scope) lines.push(`scope: ${opts.scope}`);
  if (opts.skipH1 !== base.skipH1) lines.push(`skipH1: ${opts.skipH1}`);
  if (opts.collapsed !== base.collapsed) lines.push(`collapsed: ${opts.collapsed}`);
  if (opts.hideWhenEmpty !== base.hideWhenEmpty) lines.push(`hideWhenEmpty: ${opts.hideWhenEmpty}`);
  return lines.join('\n');
}

export type Pattern = { re: RegExp } | { error: string } | null;

/** `/re/flags` is a regular expression; anything else is a case-insensitive substring. */
export function compilePattern(src: string): Pattern {
  if (!src) return null;
  const m = /^\/(.+)\/([a-z]*)$/i.exec(src);
  try {
    if (m) return { re: new RegExp(m[1], m[2].replace(/[gy]/g, '')) };
    return { re: new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') };
  } catch {
    return { error: `Not a valid pattern: ${src}` };
  }
}
