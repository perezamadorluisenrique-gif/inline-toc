import test from 'node:test';
import assert from 'node:assert/strict';

import { activeIndex } from '../src/active.ts';

test('activeIndex', () => {
  const lines = [2, 10, 20];
  assert.equal(activeIndex([], 5), -1);
  assert.equal(activeIndex(lines, 0), -1);
  assert.equal(activeIndex(lines, 2), 0);
  assert.equal(activeIndex(lines, 15), 1);
  assert.equal(activeIndex(lines, 99), 2);
});
