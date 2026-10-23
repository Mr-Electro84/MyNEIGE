'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { historyTarget } = require('../src/main/navigation');
test('history navigation refuses absent entries and destinations outside the university', () => {
  const contents = { navigationHistory: { canGoToOffset: () => false } };
  assert(!historyTarget(contents, -1));
  contents.navigationHistory = { canGoToOffset: () => true, getActiveIndex: () => 1,
    getEntryAtIndex: index => ({ url: index === 0 ? 'https://www.appigs.univ-avignon.fr/one' : 'https://evil.test/' }) };
  assert(historyTarget(contents, -1)); assert(!historyTarget(contents, 1));
});
