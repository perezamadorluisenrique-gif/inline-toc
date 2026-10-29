import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHeadings } from '../src/headings.ts';
import { layout, numberLabel, signature } from '../src/layout.ts';
import { BUILTIN } from '../src/options.ts';
import type { TocOptions } from '../src/options.ts';

const o = (x: Partial<TocOptions> = {}): TocOptions => ({ ...BUILTIN, skipH1: 'no', ...x });
const run = (md: string, x: Partial<TocOptions> = {}, ctx = {}) => layout(parseHeadings(md), o(x), ctx).items;

test('skipped levels collapse and numbering counts', () => {
  const items = run('# A\n#### B\n## C\n# D\n');
  assert.deepEqual(items.map((i) => [i.depth, i.number]), [[0, '1'], [1, '1.1'], [1, '1.2'], [0, '2']]);
});

test('min and max', () => {
  assert.deepEqual(run('## A\n### B\n# C\n## D\n', { min: 2, max: 2 }).map((i) => [i.text, i.number]), [['A', '1'], ['D', '2']]);
});

test('skipH1 auto drops a lone first H1 only', () => {
  const md = '# T\n## A\n### B\n';
  assert.deepEqual(layout(parseHeadings(md), o({ skipH1: 'auto' })).items.map((i) => [i.text, i.depth]), [['A', 0], ['B', 1]]);
  assert.equal(layout(parseHeadings('# T\n## A\n# U\n'), o({ skipH1: 'auto' })).items.length, 3);
  assert.equal(layout(parseHeadings('## A\n# T\n'), o({ skipH1: 'auto' })).items.length, 2);
  assert.equal(layout(parseHeadings('# T\n# U\n## A\n'), o({ skipH1: 'yes' })).items.length, 1);
});

test('scope section lists the children of the heading the block sits under', () => {
  const md = '# T\n## A\n\nblock\n### A1\n### A2\n## B\n\nblock\n### B1\n';
  assert.deepEqual(run(md, { scope: 'section' }, { blockLine: 3 }).map((i) => i.text), ['A1', 'A2']);
  assert.deepEqual(run(md, { scope: 'section' }, { blockLine: 8 }).map((i) => i.text), ['B1']);
  assert.equal(run('text\n# T\n## A\n', { scope: 'section' }, { blockLine: 0 }).length, 2);
});

test('include beats exclude, patterns and plain text', () => {
  const md = '## Alpha\n## Draft one\n## Beta\n';
  assert.deepEqual(run(md, { exclude: '/draft/i' }).map((i) => i.text), ['Alpha', 'Beta']);
  assert.deepEqual(run(md, { include: 'BETA', exclude: '/beta/' }).map((i) => i.text), ['Beta']);
  assert.equal(layout(parseHeadings(md), o({ exclude: '/(/' })).notes.length, 1);
});

test('number prefixes are stripped only for numbered lists where most headings have them', () => {
  const md = '## 1. A\n## 2. B\n## C\n';
  assert.deepEqual(run(md, { style: 'numbered' }, { stripNumbers: true }).map((i) => i.text), ['A', 'B', 'C']);
  assert.deepEqual(run(md, { style: 'list' }, { stripNumbers: true }).map((i) => i.text), ['1. A', '2. B', 'C']);
  assert.deepEqual(run('## 1. A\n## B\n## C\n## D\n', { style: 'numbered' }, { stripNumbers: true })[0].text, '1. A');
});

test('number labels', () => {
  const [it] = run('## A\n');
  assert.equal(numberLabel(it, { format: '1.2' }), '1');
  assert.equal(numberLabel(it, { format: '1.2.' }), '1.');
});

test('signature changes only with what is shown', () => {
  const a = layout(parseHeadings('# A\n'), o()).items;
  const b = layout(parseHeadings('# A\n'), o()).items;
  const c = layout(parseHeadings('# A\n\n# B\n'), o()).items;
  assert.equal(signature(a, o()), signature(b, o()));
  assert.notEqual(signature(a, o()), signature(c, o()));
});

test('5,000 headings are quick', () => {
  const md = Array.from({ length: 5000 }, (_, i) => `${'#'.repeat((i % 4) + 1)} Heading ${i}`).join('\n');
  const t = Date.now();
  const items = layout(parseHeadings(md), o()).items;
  assert.equal(items.length, 5000);
  assert.ok(Date.now() - t < 500);
});
