import test from 'node:test';
import assert from 'node:assert/strict';

import { applyChanges } from '../src/marked.ts';
import { adoptable, blockAt, placeBlock } from '../src/place.ts';

const put = (text: string, line: number) => applyChanges(text, [placeBlock(text, line, 'BLOCK')]);

test('inserts after the cursor line with one blank line on each side', () => {
  assert.equal(put('a\nb\nc', 0), 'a\n\nBLOCK\n\nb\nc');
  assert.equal(put('a\n\nb', 1), 'a\n\nBLOCK\n\nb');
  assert.equal(put('a', 0), 'a\n\nBLOCK\n');
  assert.equal(put('a\n', 1), 'a\n\nBLOCK\n');
  assert.equal(put('', 0), 'BLOCK\n');
});

test('never inside front matter, code, a TOC or a list', () => {
  assert.equal(put('---\nk: v\n---\ntext', 1), '---\nk: v\n---\n\nBLOCK\n\ntext');
  assert.equal(put('```\ncode\n```\ntext', 1), '```\ncode\n```\n\nBLOCK\n\ntext');
  assert.equal(put('- a\n- b\n\ntext', 0), '- a\n- b\n\nBLOCK\n\ntext');
  assert.equal(put('```toc\n```\ntext', 0), '```toc\n```\n\nBLOCK\n\ntext');
  assert.equal(put('<!-- inline-toc -->\n- x\n<!-- /inline-toc -->\ntext', 1), '<!-- inline-toc -->\n- x\n<!-- /inline-toc -->\n\nBLOCK\n\ntext');
});

test('blockAt', () => {
  const t = 'x\n```toc\nmin: 2\n```\n<!-- inline-toc -->\n- a\n<!-- /inline-toc -->\n```table-of-contents\n```';
  assert.deepEqual(blockAt(t, 2), { kind: 'live', start: 1, end: 3 });
  assert.deepEqual(blockAt(t, 5), { kind: 'marked', start: 4, end: 6 });
  assert.deepEqual(blockAt(t, 8), { kind: 'live', start: 7, end: 8 });
  assert.equal(blockAt(t, 0), null);
});

test('adoptable: lists of heading links', () => {
  const t = '**Contents**\n\n- [[#A]]\n\t- [[#A#B|B]]\n- [A](#A)\n\ntext';
  const a = adoptable(t, 3)!;
  assert.deepEqual([a.start, a.end, a.opts.title, a.opts.style], [0, 4, 'Contents', 'list']);
  assert.deepEqual(a.targets, ['A', 'B', 'A']);
  assert.equal(adoptable('1. [[#A]]\n2. [[#B]]', 0)!.opts.style, 'numbered');
  assert.equal(adoptable('- [[#A]]\n- plain', 0), null);
  assert.equal(adoptable('text', 0), null);
  const insta = adoptable('```insta-toc\nmin: 2\nmax: 3\n```', 1)!;
  assert.deepEqual([insta.start, insta.end, insta.opts.min, insta.opts.max], [0, 3, 2, 3]);
});

test('a toc block with no closing fence is not a block yet', () => {
  const t = '# A\n\n```toc\n\n## B\nimportant text\n## C\nmore';
  assert.equal(blockAt(t, 3), null);
  assert.equal(blockAt(t, 5), null);
});

test('adoptable does not throw on a lone percent sign', () => {
  assert.doesNotThrow(() => adoptable('- [50%](#50%)', 0));
});
