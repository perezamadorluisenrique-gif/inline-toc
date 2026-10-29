import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { displayText, hasNumberPrefix, linkTarget, maskLines, parseHeadings, stripNumber } from '../src/headings.ts';

const levels = (t: string) => parseHeadings(t).map((h) => [h.level, h.raw]);

test('front matter is skipped, an unclosed one is not', () => {
  assert.deepEqual(levels('---\n# x\n---\n# A'), [[1, 'A']]);
  assert.deepEqual(levels('---\n# x\n'), [[1, 'x']]);
});

test('fenced code with backticks and tildes, longer closing fence', () => {
  assert.deepEqual(levels('```\n# a\n````\n# b\n~~~\n## c\n~~~\n# d'), [[1, 'b'], [1, 'd']]);
  assert.deepEqual(levels('- item\n  ```\n  # in list code\n  ```\n# after'), [[1, 'after']]);
});

test('indent, closing hashes, tags and empty headings', () => {
  assert.deepEqual(levels('   ## ok ##\n    ## code\n#tag\n##\n#\tTab'), [[2, 'ok'], [1, 'Tab']]);
});

test('math and comment blocks', () => {
  assert.deepEqual(levels('$$\n# m\n$$\n%%\n# c\n%%\n%% # one line %%\n$$ x $$\n# yes'), [[1, 'yes']]);
});

test('html comments', () => {
  assert.deepEqual(levels('<!--\n# no\n-->\n<!-- # no -->\n# yes'), [[1, 'yes']]);
});

test('setext headings and false positives', () => {
  assert.deepEqual(levels('Title\n=====\nSub\n---\n'), [[1, 'Title'], [2, 'Sub']]);
  assert.deepEqual(levels('- item\n---\n\ntext\n\n---\n| a |\n---'), []);
});

test('headings inside callouts and list items are not headings, as in Obsidian\'s index', () => {
  assert.deepEqual(levels('> ## In quote\n- ## In list\n1. ### Numbered'), []);
});

test('CRLF', () => {
  assert.deepEqual(levels('# A\r\n## B\r\n'), [[1, 'A'], [2, 'B']]);
});

test('maskLines marks front matter and fences', () => {
  assert.deepEqual(maskLines(['---', 'a: 1', '---', 'x', '```', 'y', '```', 'z']), [true, true, true, false, true, true, true, false]);
});

test('the torture note', () => {
  const h = parseHeadings(fs.readFileSync(new URL('./fixtures/torture.md', import.meta.url), 'utf8'));
  assert.deepEqual(
    h.map((x) => x.raw),
    ['Title', 'One: **bold** and [[Page|alias]]', 'Notes', 'Deep', 'Two', 'Notes', 'Setext heading', 'Another setext'],
  );
});

test('displayText', () => {
  assert.equal(displayText('Two: **bold** and [[Page|alias]]'), 'Two: bold and alias');
  assert.equal(displayText('See [site](https://x.y) `code` ==hi== ~~no~~'), 'See site code hi no');
  assert.equal(displayText('[[Page#Sec]] and [[Plain]] ![[emb]]'), 'Sec and Plain emb');
  assert.equal(displayText('Note[^1] %%c%% <span>x</span> #tag'), 'Note x #tag');
  assert.equal(displayText('snake_case_word and _em_'), 'snake_case_word and em');
  assert.equal(displayText('2 * 3 * 4'), '2 * 3 * 4');
});

test('linkTarget follows the raw heading', () => {
  assert.equal(linkTarget('Two: **bold** and [[Page|alias]]'), 'Two **bold** and Page alias');
  assert.equal(linkTarget('A #1 | B ^ C \\ [d]'), 'A 1 B C d');
  assert.equal(linkTarget('###'), '');
  assert.equal(linkTarget('x %%hidden%% y'), 'x y');
});

test('heading numbers', () => {
  assert.equal(hasNumberPrefix('1. A'), true);
  assert.equal(hasNumberPrefix('1.2 A'), true);
  assert.equal(hasNumberPrefix('2.3.1) A'), true);
  assert.equal(hasNumberPrefix('IV. A'), true);
  assert.equal(hasNumberPrefix('2024 plans'), false);
  assert.equal(stripNumber('1.2 Alpha'), 'Alpha');
});
