import test from 'node:test';
import assert from 'node:assert/strict';

import { applyChanges, findMarkedBlocks, refreshChanges, renderMarkedBlock } from '../src/marked.ts';
import { parseHeadings } from '../src/headings.ts';
import { BUILTIN } from '../src/options.ts';

const ctx = { stripNumbers: true, style: { linkFormat: 'wiki' as const, titleLine: 'bold' as const } };
const notitle = { ...BUILTIN, title: '' };

test('an empty note gives just the markers', () => {
  assert.equal(renderMarkedBlock([], notitle, ctx).text, '<!-- inline-toc title="" -->\n<!-- /inline-toc -->');
});

test('blocks and orphans', () => {
  const t = '<!-- inline-toc -->\nx\n<!-- /inline-toc -->\n<!-- inline-toc -->\n<!-- inline-toc min=2 -->\n<!-- /inline-toc -->\n<!-- inline-toc';
  const r = findMarkedBlocks(t);
  assert.deepEqual(r.blocks.map((b) => [b.openLine, b.closeLine]), [[0, 2], [4, 5]]);
  assert.deepEqual(r.orphans, [3]);
});

test('markers inside fences are ignored', () => {
  assert.deepEqual(findMarkedBlocks('```\n<!-- inline-toc -->\n<!-- /inline-toc -->\n```').blocks, []);
});

test('refresh: one change per changed block, none when up to date', () => {
  const note = '# A\n## B\n\n<!-- inline-toc title="" skipH1=no -->\n- stale\n<!-- /inline-toc -->\n\n<!-- inline-toc min=2 title="" skipH1=no -->\n<!-- /inline-toc -->\n';
  const r = refreshChanges(note, ctx);
  assert.equal(r.blocks, 2);
  assert.equal(r.changes.length, 2);
  const out = applyChanges(note, r.changes);
  assert.equal(out, '# A\n## B\n\n<!-- inline-toc title="" skipH1=no -->\n- [[#A]]\n  - [[#B]]\n<!-- /inline-toc -->\n\n<!-- inline-toc min=2 title="" skipH1=no -->\n- [[#B]]\n<!-- /inline-toc -->\n');
  assert.equal(refreshChanges(out, ctx).changes.length, 0);
});

test('a marked block never feeds its own links back as headings', () => {
  const note = '## A\n\n<!-- inline-toc -->\n**Contents**\n\n- [[#A]]\n<!-- /inline-toc -->\n';
  assert.equal(parseHeadings(note).length, 1);
  assert.equal(refreshChanges(note, ctx).changes.length, 0);
});

test('scope section uses the block position', () => {
  const note = '## A\n\n<!-- inline-toc title="" scope=section skipH1=no -->\n<!-- /inline-toc -->\n\n### a1\n\n## B\n### b1\n';
  const out = applyChanges(note, refreshChanges(note, ctx).changes);
  assert.ok(out.includes('- [[#a1]]') && !out.includes('b1]]'));
});
