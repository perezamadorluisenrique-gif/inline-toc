import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILTIN, blockBody, compilePattern, markerLine, parseMarker, parseOptions } from '../src/options.ts';

test('every alias and separator', () => {
  for (const src of ['min: 2', 'min = 2', 'min 2', 'minLevel: 2', 'min-level: 2', 'MIN_LEVEL: 2', 'minDepth: 2', 'from: 2']) {
    assert.equal(parseOptions(src).opts.min, 2, src);
  }
});

test('an Automatic Table of Contents block parses without notes', () => {
  const r = parseOptions('title: "Contents"  # the title\nstyle: nestedOrderedList\nminLevel: 2 # shallowest\nmaxLevel: 0\nincludeLinks: false\ndebugInConsole: false');
  assert.deepEqual(r.notes, []);
  assert.equal(r.opts.title, 'Contents');
  assert.equal(r.opts.style, 'numbered');
  assert.equal(r.opts.format, '1.');
  assert.equal(r.opts.min, 2);
  assert.equal(r.opts.max, 6);
  assert.equal(r.opts.links, false);
});

test('levels, bare keys and booleans', () => {
  assert.deepEqual([parseOptions('levels: 2-4').opts.min, parseOptions('levels: 2-4').opts.max], [2, 4]);
  assert.equal(parseOptions('levels: 3').opts.max, 3);
  assert.equal(parseOptions('numbered').opts.style, 'numbered');
  assert.equal(parseOptions('collapsed').opts.collapsed, true);
  assert.equal(parseOptions('hideWhenEmpty: off').opts.hideWhenEmpty, false);
  assert.equal(parseOptions('skipTitle: no').opts.skipH1, 'no');
  assert.equal(parseOptions('skipH1: yes').opts.skipH1, 'yes');
});

test('max never goes below min', () => {
  const o = parseOptions('min: 4\nmax: 2').opts;
  assert.deepEqual([o.min, o.max], [4, 4]);
});

test('bad values and unknown keys become notes, never errors', () => {
  const r = parseOptions('min: 9\nfoo: 1\nstyle: weird\nlinks: maybe');
  assert.equal(r.notes.length, 4);
  assert.ok(r.notes.includes('Ignored: foo'));
  assert.equal(r.opts.min, BUILTIN.min);
});

test('titles: empty removes the header, quotes and free text work', () => {
  assert.equal(parseOptions('title:').opts.title, '');
  assert.equal(parseOptions("title: 'In this note'").opts.title, 'In this note');
  assert.equal(parseOptions('title: In this note').opts.title, 'In this note');
});

test('patterns keep # and / inside', () => {
  assert.equal(parseOptions('exclude: /^C#|x\\/y/i').opts.exclude, '/^C#|x\\/y/i');
  const p = compilePattern('/draft/i');
  assert.ok(p && 're' in p && p.re.test('My DRAFT'));
  const t = compilePattern('a.b');
  assert.ok(t && 're' in t && t.re.test('A.B') && !t.re.test('axb'));
  assert.ok(compilePattern('/(/') && 'error' in compilePattern('/(/')!);
  assert.equal(compilePattern(''), null);
});

test('marker round trip writes only what differs, in a fixed order', () => {
  assert.equal(markerLine(BUILTIN), '<!-- inline-toc -->');
  const opts = { ...BUILTIN, min: 2, max: 4, style: 'numbered' as const, title: 'My "TOC"', exclude: '/Draft/i', links: false, collapsed: true };
  const line = markerLine(opts);
  assert.equal(line, '<!-- inline-toc min=2 max=4 style=numbered title="My &quot;TOC&quot;" exclude="/Draft/i" links=false collapsed -->');
  const back = parseMarker(line)!;
  assert.deepEqual(back.opts, opts);
  assert.deepEqual(back.notes, []);
});

test('the draft marker syntax still parses', () => {
  const m = parseMarker('<!-- inline-toc min=2 max=3 numbered title="In this note" -->')!;
  assert.deepEqual([m.opts.min, m.opts.max, m.opts.style, m.opts.title], [2, 3, 'numbered', 'In this note']);
  assert.equal(parseMarker('<!-- something else -->'), null);
});

test('blockBody mirrors the marker', () => {
  const opts = { ...BUILTIN, min: 2, style: 'inline' as const };
  assert.deepEqual(parseOptions(blockBody(opts)).opts, opts);
});
