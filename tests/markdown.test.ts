import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHeadings } from '../src/headings.ts';
import { layout } from '../src/layout.ts';
import { toMarkdown } from '../src/markdown.ts';
import { BUILTIN } from '../src/options.ts';
import type { TocOptions } from '../src/options.ts';

const md = (src: string, x: Partial<TocOptions> = {}, style = { linkFormat: 'wiki' as const, titleLine: 'bold' as const }) => {
  const opts: TocOptions = { ...BUILTIN, skipH1: 'no', title: '', ...x };
  const all = parseHeadings(src);
  return toMarkdown(layout(all, opts).items, all, opts, style);
};

test('bullets with two-space indent, alias only when the target differs', () => {
  assert.equal(md('# A\n## B: c\n').text, '- [[#A]]\n  - [[#B c|B: c]]');
});

test('numbered formats', () => {
  assert.equal(md('# A\n## B\n', { style: 'numbered', format: '1.2' }).text, '- 1 [[#A]]\n  - 1.1 [[#B]]');
  assert.equal(md('# A\n## B\n', { style: 'numbered', format: '1.2.' }).text, '- 1\\. [[#A]]\n  - 1.1. [[#B]]');
  assert.equal(md('# A\n## B\n', { style: 'numbered', format: '1.' }).text, '1. [[#A]]\n   1. [[#B]]');
});

test('inline keeps the first level on one line', () => {
  assert.equal(md('# A\n## x\n# B\n', { style: 'inline' }).text, '[[#A]] · [[#B]]');
});

test('duplicate headings get the shortest unique path', () => {
  const r = md('# A\n## Notes\n# B\n## Notes\n');
  assert.equal(r.text, '- [[#A]]\n  - [[#A#Notes|Notes]]\n- [[#B]]\n  - [[#B#Notes|Notes]]');
  assert.deepEqual(r.warnings, []);
});

test('identical siblings link the first and warn', () => {
  const r = md('# A\n## N\n## N\n');
  assert.equal(r.text, '- [[#A]]\n  - [[#N]]\n  - [[#N]]');
  assert.deepEqual(r.warnings, ['2 headings share a name; links go to the first.']);
});

test('alias safety', () => {
  assert.equal(md('# A | B\n').text, '- [[#A B|A - B]]');
  assert.equal(md('# [[x]] y\n').text, '- [[#x y]]');
  assert.equal(md('# :\n').text, '- :');
});

test('Markdown links', () => {
  const r = md('# Hello (world) [x]\n', {}, { linkFormat: 'markdown', titleLine: 'bold' });
  assert.equal(r.text, '- [Hello (world) \\[x\\]](#Hello%20%28world%29%20%20x%20)'.replace('%20%20x%20)', '%20x)'));
});

test('title lines and links off', () => {
  assert.equal(md('# A\n', { title: 'Contents' }).text, '**Contents**\n\n- [[#A]]');
  assert.equal(md('# A\n', { title: 'Contents' }, { linkFormat: 'wiki', titleLine: 'plain' }).text, 'Contents\n\n- [[#A]]');
  assert.equal(md('# A\n', { title: 'Contents' }, { linkFormat: 'wiki', titleLine: 'none' }).text, '- [[#A]]');
  assert.equal(md('# A\n', { links: false }).text, '- A');
  assert.equal(md('', { title: 'Contents' }).text, '**Contents**');
});
