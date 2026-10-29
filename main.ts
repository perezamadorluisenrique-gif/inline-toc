import { EditorView } from '@codemirror/view';
import {
  Keymap,
  MarkdownRenderChild,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  debounce,
  setIcon,
} from 'obsidian';
import type { App, Editor, HoverParent, HoverPopover, MarkdownPostProcessorContext, SettingDefinitionItem, TAbstractFile } from 'obsidian';

import {
  DEFAULT_SETTINGS,
  activeIndex,
  adoptable,
  blockAt,
  blockBody,
  compilePattern,
  findMarkedBlocks,
  layout,
  linkTarget,
  numberLabel,
  optionsFromSettings,
  parseHeadings,
  parseOptions,
  placeBlock,
  refreshChanges,
  renderMarkedBlock,
  signature,
  toMarkdown,
} from './src/logic.ts';
import type { Heading, RenderContext, Settings, TocItem, TocOptions } from './src/logic.ts';

const LANGUAGES = ['toc', 'table-of-contents'];

/** A live table of contents: re-reads the note's headings whenever Obsidian re-indexes the note. */
class TocBlock extends MarkdownRenderChild implements HoverParent {
  hoverPopover: HoverPopover | null = null;
  id: number;
  path: string;
  /** Item elements in order, for the current-section highlight. */
  itemEls: { line: number; el: HTMLElement }[] = [];
  private nav: HTMLElement;
  private sig = '';
  private again: number | null = null;

  constructor(
    private plugin: InlineTOCPlugin,
    el: HTMLElement,
    private source: string,
    path: string,
    private ctx: MarkdownPostProcessorContext,
  ) {
    super(el);
    this.path = path;
    this.id = ++plugin.counter;
    this.nav = el.createEl('nav', { cls: 'inline-toc' });
  }

  onload() {
    this.plugin.register_(this);
    this.render();
  }

  onunload() {
    this.plugin.unregister_(this);
    if (this.again !== null) window.clearTimeout(this.again);
  }

  private blockLine(): number | undefined {
    return this.ctx.getSectionInfo(this.containerEl)?.lineStart;
  }

  private key(): string {
    return `${this.path}:${this.blockLine() ?? this.id}`;
  }

  render(force = false) {
    const nav = this.nav;
    const s = this.plugin.settings;
    const { opts, notes } = parseOptions(this.source, optionsFromSettings(s));
    const file = this.plugin.app.vault.getFileByPath(this.path);
    const cache = file ? this.plugin.app.metadataCache.getFileCache(file) : null;
    nav.toggleClass('is-framed', s.framed);

    if (!file || (!cache && !file.path.endsWith('.md'))) {
      this.paint('unavailable', () => nav.createDiv({ cls: 'inline-toc-note', text: 'Table of contents is not available here.' }), force);
      return;
    }
    const headings: Heading[] = (cache?.headings ?? []).map((h) => ({ level: h.level, raw: h.heading, line: h.position.start.line }));
    const line = this.blockLine();
    const result = layout(headings, opts, { stripNumbers: s.stripNumbers, blockLine: line });
    const allNotes = [...notes, ...result.notes];
    const sig = signature(result.items, opts) + JSON.stringify([allNotes, s.framed, line]);
    if (opts.scope === 'section' && line === undefined && this.again === null) {
      // The section position is only known once Obsidian has attached the block.
      this.again = window.setTimeout(() => {
        this.again = null;
        this.render();
      }, 60);
    }
    this.paint(sig, () => this.build(result.items, opts, allNotes), force);
  }

  private paint(sig: string, build: () => void, force: boolean) {
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.nav.empty();
    this.itemEls = [];
    build();
    this.plugin.refreshActive(this.containerEl);
  }

  private build(items: TocItem[], opts: TocOptions, notes: string[]) {
    const nav = this.nav;
    nav.removeClass('is-collapsed');
    nav.toggleClass('is-hidden', opts.hideWhenEmpty && items.length === 0);
    const key = this.key();
    const bodyId = `inline-toc-${this.id}-body`;
    const titleId = `inline-toc-${this.id}-title`;
    const collapsed = this.plugin.collapsed.get(key) ?? opts.collapsed;

    if (opts.title) {
      nav.setAttr('aria-labelledby', titleId);
      nav.removeAttribute('aria-label');
      const header = nav.createDiv({ cls: 'inline-toc-header' });
      const toggle = header.createEl('button', { cls: 'inline-toc-toggle clickable-icon', attr: { type: 'button', 'aria-controls': bodyId } });
      header.createSpan({ cls: 'inline-toc-title', text: opts.title, attr: { id: titleId } });
      const body = nav.createDiv({ cls: 'inline-toc-body', attr: { id: bodyId } });
      const apply = (c: boolean) => {
        nav.toggleClass('is-collapsed', c);
        body.hidden = c;
        toggle.setAttr('aria-expanded', String(!c));
        toggle.setAttr('aria-label', c ? 'Expand table of contents' : 'Collapse table of contents');
        toggle.empty();
        setIcon(toggle, c ? 'chevron-right' : 'chevron-down');
        toggle.querySelector('svg')?.setAttr('aria-hidden', 'true');
      };
      apply(collapsed);
      toggle.addEventListener('click', () => {
        const next = !nav.hasClass('is-collapsed');
        this.plugin.collapsed.set(key, next);
        apply(next);
      });
      header.addEventListener('dblclick', (ev) => ev.preventDefault());
      this.fill(body, items, opts, notes);
    } else {
      nav.setAttr('aria-label', 'Table of contents');
      nav.removeAttribute('aria-labelledby');
      this.fill(nav.createDiv({ cls: 'inline-toc-body', attr: { id: bodyId } }), items, opts, notes);
    }
  }

  private fill(body: HTMLElement, items: TocItem[], opts: TocOptions, notes: string[]) {
    if (!items.length) body.createDiv({ cls: 'inline-toc-empty', text: 'No headings yet.' });
    else if (opts.style === 'inline') {
      const p = body.createDiv({ cls: 'inline-toc-inline' });
      items.filter((it) => it.depth === 0).forEach((it, n) => {
        if (n) p.createSpan({ cls: 'inline-toc-sep', text: ' · ' });
        const li = p.createSpan({ cls: 'inline-toc-item', attr: { 'data-line': String(it.line) } });
        this.link(li, it, opts);
        this.itemEls.push({ line: it.line, el: li });
      });
    } else this.list(body, items, opts);
    for (const n of notes) body.createDiv({ cls: 'inline-toc-note', text: n });
  }

  private list(body: HTMLElement, items: TocItem[], opts: TocOptions) {
    const ordered = opts.style === 'numbered' && opts.format === '1.';
    const numbered = opts.style === 'numbered' && !ordered;
    const make = (p: HTMLElement) => p.createEl(ordered ? 'ol' : 'ul', { cls: ['inline-toc-list', ...(numbered ? ['is-numbered'] : []), ...(ordered ? ['is-ordered'] : [])] });
    const lists: HTMLElement[] = [make(body)];
    const lastLi: HTMLElement[] = [];
    const lastItem: TocItem[] = [];
    for (const it of items) {
      while (lists.length > it.depth + 1) lists.pop();
      while (lists.length < it.depth + 1) {
        const parentLi = lastLi[lists.length - 1];
        const parentItem = lastItem[lists.length - 1];
        const child = make(parentLi);
        this.foldButton(parentLi, child, parentItem);
        lists.push(child);
      }
      const li = lists[it.depth].createEl('li', { cls: 'inline-toc-item', attr: { 'data-line': String(it.line) } });
      lastLi[it.depth] = li;
      lastItem[it.depth] = it;
      if (numbered) li.createSpan({ cls: 'inline-toc-number', text: `${numberLabel(it, opts)} ` });
      this.link(li, it, opts);
      this.itemEls.push({ line: it.line, el: li });
    }
  }

  private foldButton(li: HTMLElement, child: HTMLElement, item: TocItem) {
    const key = `${this.path}:${item.line}`;
    const btn = createEl('button', { cls: 'inline-toc-fold clickable-icon', attr: { type: 'button' } });
    li.insertBefore(btn, li.firstChild);
    li.addClass('has-children');
    const apply = (folded: boolean) => {
      child.hidden = folded;
      li.toggleClass('is-folded', folded);
      btn.setAttr('aria-expanded', String(!folded));
      btn.setAttr('aria-label', `${folded ? 'Expand' : 'Collapse'} ${item.text}`);
      btn.empty();
      setIcon(btn, 'chevron-down');
      btn.querySelector('svg')?.setAttr('aria-hidden', 'true');
    };
    apply(this.plugin.folded.get(key) ?? false);
    btn.addEventListener('click', () => {
      const next = !child.hidden;
      this.plugin.folded.set(key, next);
      apply(next);
    });
  }

  private link(parent: HTMLElement, it: TocItem, opts: TocOptions) {
    if (!opts.links) {
      parent.createSpan({ cls: 'inline-toc-link', text: it.text });
      return;
    }
    const a = parent.createEl('a', { cls: 'inline-toc-link', text: it.text, attr: { href: `#${it.target}`, 'data-line': String(it.line) } });
    a.addEventListener('mousedown', (ev) => ev.stopPropagation());
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void this.plugin.goTo(this, it, Keymap.isModEvent(ev) !== false);
    });
    a.addEventListener('auxclick', (ev) => {
      if (ev.button !== 1) return;
      ev.preventDefault();
      void this.plugin.goTo(this, it, true);
    });
    a.addEventListener('mouseover', (ev) => {
      this.plugin.app.workspace.trigger('hover-link', {
        event: ev,
        source: 'inline-toc',
        hoverParent: this,
        targetEl: a,
        linktext: `${this.path}#${it.target}`,
        sourcePath: this.path,
      });
    });
  }

  /** Marks the item of the section the reader is in. */
  setActive(index: number) {
    this.itemEls.forEach(({ el }, i) => {
      const on = i === index;
      el.toggleClass('is-active', on);
      const link = el.querySelector('.inline-toc-link');
      if (on) link?.setAttr('aria-current', 'location');
      else link?.removeAttribute('aria-current');
    });
  }
}

export default class InlineTOCPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  counter = 0;
  collapsed = new Map<string, boolean>();
  folded = new Map<string, boolean>();
  blockedLanguages: string[] = [];
  private blocks = new Map<string, Set<TocBlock>>();
  /** Whether the latest document change was an undo or redo. */
  private lastWasHistory = false;
  private lastSig = new Map<string, string>();
  private activeQueued = false;

  async onload() {
    const data = (await this.loadData()) as Partial<Settings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    this.addSettingTab(new InlineTOCSettingTab(this.app, this));

    for (const lang of LANGUAGES) {
      try {
        this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
          ctx.addChild(new TocBlock(this, el, source, ctx.sourcePath, ctx));
        });
      } catch {
        this.blockedLanguages.push(lang);
      }
    }
    this.registerHoverLinkSource('inline-toc', { display: 'Inline TOC', defaultMod: true });

    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.blocks.get(file.path)?.forEach((b) => b.render());
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        const set = this.blocks.get(oldPath);
        if (!set) return;
        this.blocks.delete(oldPath);
        this.blocks.set(file.path, set);
        set.forEach((b) => {
          b.path = file.path;
        });
      }),
    );

    this.registerEditorExtension(
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          this.lastWasHistory = u.transactions.some((tr) => tr.isUserEvent('undo') || tr.isUserEvent('redo'));
        }
        if (u.selectionSet || u.docChanged || u.viewportChanged) this.queueActive(u.view.dom);
      }),
    );
    this.registerEvent(this.app.workspace.on('editor-change', (editor) => this.autoRefresh(editor)));
    this.registerDomEvent(activeDocument, 'scroll', (ev) => this.queueActive(ev.target as HTMLElement), { capture: true, passive: true });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.queueActive(null)));

    this.addCommands();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.renderAll();
  }

  renderAll() {
    this.blocks.forEach((set) => set.forEach((b) => b.render()));
  }

  register_(b: TocBlock) {
    let set = this.blocks.get(b.path);
    if (!set) this.blocks.set(b.path, (set = new Set()));
    set.add(b);
  }

  unregister_(b: TocBlock) {
    this.blocks.get(b.path)?.delete(b);
  }

  /** For the e2e spec: the lines this plugin takes for headings. */
  debugHeadingLines(text: string): number[] {
    return parseHeadings(text).map((h) => h.line);
  }

  // ---- navigation -------------------------------------------------------

  private viewOf(el: HTMLElement): MarkdownView | null {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(el)) return leaf.view;
    }
    return null;
  }

  /** Goes to the heading by line, so repeated heading names land on the right one. */
  async goTo(block: TocBlock, item: TocItem, newTab: boolean) {
    const view = this.viewOf(block.containerEl);
    if (!newTab && view && view.file?.path === block.path) {
      if (view.getMode() === 'preview') view.previewMode.applyScroll(item.line);
      else {
        const pos = { line: item.line, ch: 0 };
        view.editor.setCursor(pos);
        view.editor.scrollIntoView({ from: pos, to: pos }, true);
      }
      return;
    }
    const file = this.app.vault.getFileByPath(block.path);
    if (!file) return;
    const leaf = this.app.workspace.getLeaf(newTab ? 'tab' : false);
    await leaf.openFile(file, { eState: { line: item.line } });
  }

  // ---- current-section highlight ---------------------------------------

  private queueActive(from: HTMLElement | null) {
    if (!this.settings.highlight || this.activeQueued) return;
    this.activeQueued = true;
    window.requestAnimationFrame(() => {
      this.activeQueued = false;
      this.refreshActive(from);
    });
  }

  /** Updates the highlight of every block in the view that holds `from` (all views when null). */
  refreshActive(from: HTMLElement | null) {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) continue;
      if (from && !view.containerEl.contains(from)) continue;
      const set = this.blocks.get(view.file.path);
      if (!set) continue;
      for (const block of set) {
        if (!view.containerEl.contains(block.containerEl)) continue;
        if (!this.settings.highlight) {
          block.setActive(-1);
          continue;
        }
        const lines = block.itemEls.map((i) => i.line);
        block.setActive(activeIndex(lines, this.topLine(view)));
      }
    }
  }

  private topLine(view: MarkdownView): number {
    if (view.getMode() === 'source' && view.editor.hasFocus()) return view.editor.getCursor().line;
    return Math.floor(view.currentMode.getScroll()) + 1;
  }

  // ---- Markdown mode ----------------------------------------------------

  private renderCtx(): RenderContext {
    return { stripNumbers: this.settings.stripNumbers, style: { linkFormat: this.settings.linkFormat, titleLine: this.settings.titleLine } };
  }

  private autoRefreshNow = debounce(
    (editor: Editor) => {
      if (!this.settings.autoRefresh || this.lastWasHistory) return;
      const text = editor.getValue();
      if (!text.includes('<!-- inline-toc')) return;
      const cm = (editor as unknown as { cm?: EditorView }).cm;
      if (cm?.composing) return;
      const sig = parseHeadings(text).map((h) => `${h.level}|${h.raw}`).join('\n');
      const { changes, blocks } = refreshChanges(text, this.renderCtx());
      const key = this.app.workspace.getActiveFile()?.path ?? '';
      if (!changes.length || (this.lastSig.get(key) === sig && blocks === 0)) return;
      const cur = editor.getCursor();
      if (findMarkedBlocks(text).blocks.some((b) => cur.line >= b.openLine && cur.line <= b.closeLine)) return;
      this.lastSig.set(key, sig);
      editor.transaction({ changes });
    },
    2000,
    true,
  );

  private autoRefresh(editor: Editor) {
    if (this.settings.autoRefresh) this.autoRefreshNow(editor);
  }

  private refreshMarkdown(editor: Editor): boolean {
    const text = editor.getValue();
    const r = refreshChanges(text, this.renderCtx());
    if (!r.blocks && r.orphans.length) {
      new Notice(`The table of contents marker on line ${r.orphans[0] + 1} has no closing <!-- /inline-toc --> line.`);
      return false;
    }
    const extra = r.warnings.length ? ` ${r.warnings.join(' ')}` : '';
    if (!r.changes.length) {
      new Notice(`Table of contents is up to date.${extra}`);
      return false;
    }
    editor.transaction({ changes: r.changes });
    new Notice(`Refreshed ${r.changes.length === 1 ? 'the table of contents' : `${r.changes.length} tables of contents`}.${extra}`);
    return true;
  }

  private insertBlock(editor: Editor, block: string) {
    const change = placeBlock(editor.getValue(), editor.getCursor('to').line, block);
    editor.transaction({ changes: [change] });
  }

  private addCommands() {
    this.addCommand({
      id: 'insert-live-toc',
      name: 'Insert table of contents',
      icon: 'list-tree',
      editorCallback: (editor) => this.insertBlock(editor, '```toc\n```'),
    });

    this.addCommand({
      id: 'insert-markdown-toc',
      name: 'Insert Markdown table of contents',
      icon: 'list-ordered',
      editorCallback: (editor) => {
        const text = editor.getValue();
        if (findMarkedBlocks(text).blocks.length) {
          this.refreshMarkdown(editor);
          new Notice('This note already has a table of contents. Refreshed it.');
          return;
        }
        const line = editor.getCursor('to').line;
        const r = renderMarkedBlock(parseHeadings(text), optionsFromSettings(this.settings), this.renderCtx(), line + 1);
        this.insertBlock(editor, r.text);
        if (r.warnings.length) new Notice(r.warnings.join(' '));
      },
    });

    this.addCommand({
      id: 'refresh-markdown-toc',
      name: 'Refresh Markdown tables of contents',
      icon: 'refresh-cw',
      editorCheckCallback: (checking, editor) => {
        const r = findMarkedBlocks(editor.getValue());
        if (!r.blocks.length && !r.orphans.length) return false;
        if (!checking) this.refreshMarkdown(editor);
        return true;
      },
    });

    this.addCommand({
      id: 'toggle-toc-mode',
      name: 'Switch table of contents between live and Markdown',
      icon: 'repeat',
      editorCheckCallback: (checking, editor) => {
        const text = editor.getValue();
        const at = blockAt(text, editor.getCursor().line);
        if (!at) return false;
        if (checking) return true;
        const lines = text.split('\n');
        const base = optionsFromSettings(this.settings);
        let out: string;
        if (at.kind === 'live') {
          const opts = parseOptions(lines.slice(at.start + 1, at.end).join('\n'), base).opts;
          out = renderMarkedBlock(parseHeadings(text), opts, this.renderCtx(), at.start).text;
        } else {
          const marker = findMarkedBlocks(text).blocks.find((b) => b.openLine === at.start);
          const body = marker ? blockBody(marker.opts, base) : '';
          out = `\`\`\`toc\n${body}${body ? '\n' : ''}\`\`\``;
        }
        editor.transaction({
          changes: [{ from: { line: at.start, ch: 0 }, to: { line: at.end, ch: lines[at.end].length }, text: out }],
        });
        return true;
      },
    });

    this.addCommand({
      id: 'insert-section-toc',
      name: 'Insert table of contents for this section',
      icon: 'list-plus',
      editorCheckCallback: (checking, editor) => {
        const text = editor.getValue();
        const line = editor.getCursor('to').line;
        if (!parseHeadings(text).some((h) => h.line <= line)) return false;
        if (checking) return true;
        const opts = { ...optionsFromSettings(this.settings), scope: 'section' as const, title: '', skipH1: 'no' as const };
        if (this.settings.insertFormat === 'markdown') {
          const r = renderMarkedBlock(parseHeadings(text), opts, this.renderCtx(), line + 1);
          this.insertBlock(editor, r.text);
        } else {
          const body = blockBody(opts, optionsFromSettings(this.settings));
          this.insertBlock(editor, `\`\`\`toc\n${body}\n\`\`\``);
        }
        return true;
      },
    });

    this.addCommand({
      id: 'adopt-toc',
      name: 'Adopt existing table of contents',
      icon: 'list-checks',
      editorCheckCallback: (checking, editor) => {
        const text = editor.getValue();
        const found = adoptable(text, editor.getCursor().line);
        if (!found) return false;
        if (checking) return true;
        const headings = parseHeadings(text);
        const levels = found.targets
          .map((t) => headings.find((h) => linkTarget(h.raw) === t)?.level)
          .filter((l): l is number => l !== undefined);
        const opts = { ...found.opts };
        if (levels.length) {
          opts.min = Math.min(...levels);
          opts.max = Math.max(...levels);
        }
        const lines = text.split('\n');
        const r = renderMarkedBlock(headings, opts, this.renderCtx(), found.start);
        editor.transaction({
          changes: [{ from: { line: found.start, ch: 0 }, to: { line: found.end, ch: lines[found.end].length }, text: r.text }],
        });
        new Notice('Adopted the table of contents; it will now stay up to date.');
        return true;
      },
    });

    this.addCommand({
      id: 'copy-toc',
      name: 'Copy table of contents as Markdown',
      icon: 'copy',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (checking) return true;
        const headings = parseHeadings(view.editor.getValue());
        const opts = optionsFromSettings(this.settings);
        const { items } = layout(headings, opts, { stripNumbers: this.settings.stripNumbers });
        const md = toMarkdown(items, headings, opts, this.renderCtx().style).text;
        void navigator.clipboard.writeText(md).then(() => new Notice(`Copied the table of contents (${items.length} headings).`));
        return true;
      },
    });
  }
}

type Field =
  | { key: keyof Settings; name: string; desc?: string; kind: 'text' }
  | { key: keyof Settings; name: string; desc?: string; kind: 'toggle' }
  | { key: keyof Settings; name: string; desc?: string; kind: 'dropdown'; options: Record<string, string> };

const LEVELS = { '1': 'Heading 1', '2': 'Heading 2', '3': 'Heading 3', '4': 'Heading 4', '5': 'Heading 5', '6': 'Heading 6' };

/** Shared by the declarative tab of Obsidian 1.13+ and the older `display()`. */
const GROUPS: { heading: string; fields: Field[] }[] = [
  {
    heading: 'Table of contents',
    fields: [
      { key: 'title', kind: 'text', name: 'Title', desc: 'Shown above the list. Leave empty for no title.' },
      { key: 'min', kind: 'dropdown', name: 'Lowest heading level', options: LEVELS },
      { key: 'max', kind: 'dropdown', name: 'Highest heading level', options: LEVELS },
      { key: 'style', kind: 'dropdown', name: 'Style', options: { list: 'Bullets', numbered: 'Numbers', inline: 'Inline' } },
      { key: 'format', kind: 'dropdown', name: 'Number format', desc: 'Used when the style is numbers.', options: { '1.2': '1.2', '1.2.': '1.2.', '1.': '1. (plain list)' } },
      { key: 'skipH1', kind: 'dropdown', name: 'Leave out the note title', desc: 'Automatic leaves out a first heading 1 when it is the only one.', options: { auto: 'Automatic', yes: 'Always leave out heading 1', no: 'Never' } },
      { key: 'exclude', kind: 'text', name: 'Exclude headings matching', desc: 'Plain text, or a regular expression such as /draft/i. Leave empty to include everything.' },
      { key: 'stripNumbers', kind: 'toggle', name: 'Strip existing heading numbers', desc: 'When the style is numbers, drop numbers like 1.2 that the headings already start with.' },
    ],
  },
  {
    heading: 'Live block',
    fields: [
      { key: 'highlight', kind: 'toggle', name: 'Highlight the current section' },
      { key: 'startCollapsed', kind: 'toggle', name: 'Start collapsed' },
      { key: 'framed', kind: 'toggle', name: 'Show a frame', desc: 'A border and background around the block.' },
    ],
  },
  {
    heading: 'Markdown tables of contents',
    fields: [
      { key: 'autoRefresh', kind: 'toggle', name: 'Keep up to date while editing', desc: 'Refreshes the list two seconds after you change a heading. Never after an undo or redo, or while the cursor is inside the list.' },
      { key: 'linkFormat', kind: 'dropdown', name: 'Link format', options: { wiki: 'Wikilinks', markdown: 'Markdown links' } },
      { key: 'titleLine', kind: 'dropdown', name: 'Title line', options: { bold: 'Bold text', plain: 'Plain text', none: 'None' } },
      { key: 'insertFormat', kind: 'dropdown', name: 'Format for section tables of contents', desc: 'What the section command writes: a live block or Markdown.', options: { live: 'Live block', markdown: 'Markdown' } },
    ],
  },
];

const NUMERIC = new Set<string>(['min', 'max']);

class InlineTOCSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: InlineTOCPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const d = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
    return GROUPS.map((g) => ({
      type: 'group' as const,
      heading: g.heading,
      items: g.fields.map((f) => {
        const base = { name: f.name, ...(f.desc ? { desc: f.desc } : {}) };
        const dv = d[f.key];
        if (f.kind === 'text') return { ...base, control: { type: 'text' as const, key: f.key, defaultValue: String(dv) } };
        if (f.kind === 'toggle') return { ...base, control: { type: 'toggle' as const, key: f.key, defaultValue: Boolean(dv) } };
        return { ...base, control: { type: 'dropdown' as const, key: f.key, options: f.options, defaultValue: String(dv) } };
      }),
    }));
  }

  getControlValue(key: string): unknown {
    const v = (this.plugin.settings as unknown as Record<string, unknown>)[key];
    return NUMERIC.has(key) ? String(v) : v;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    if (key === 'exclude') {
      const p = compilePattern(String(value));
      if (p && 'error' in p) return;
    }
    Object.assign(s, { [key]: NUMERIC.has(key) ? Number(value) : value });
    if (s.max < s.min) {
      if (key === 'min') s.max = s.min;
      else s.min = s.max;
    }
    await this.plugin.saveSettings();
    this.plugin.refreshActive(null);
  }

  /** The pre-1.13 rendering, from the same table. Obsidian skips it once `getSettingDefinitions()` returns anything. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    for (const g of GROUPS) {
      new Setting(containerEl).setName(g.heading).setHeading();
      for (const f of g.fields) {
        const row = new Setting(containerEl).setName(f.name);
        if (f.desc) row.setDesc(f.desc);
        const value = this.getControlValue(f.key);
        const save = (v: unknown) => void this.setControlValue(f.key, v);
        if (f.kind === 'text') row.addText((t) => t.setValue(String(value)).onChange(save));
        else if (f.kind === 'toggle') row.addToggle((t) => t.setValue(Boolean(value)).onChange(save));
        else row.addDropdown((dd) => dd.addOptions(f.options).setValue(String(value)).onChange(save));
      }
    }
    new Setting(containerEl).setName('Compatibility').setHeading();
    const blocked = this.plugin.blockedLanguages;
    containerEl.createDiv({
      cls: 'setting-item-description',
      text: blocked.length
        ? `Another plugin already renders ${blocked.join(' and ')} blocks. Disable it and reload to let Inline TOC render them.`
        : 'Inline TOC renders toc and table-of-contents code blocks.',
    });
  }
}
