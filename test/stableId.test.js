'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const stableId = require('../src/utils/stableId');

test('match stable IDs are deterministic and opaque', () => {
  const first = stableId('match', 'varzesh3', 475878);
  const second = stableId('match', 'varzesh3', 475878);

  assert.equal(first, second);
  assert.match(first, /^mp_match_[a-f0-9]{24}$/);
  assert.equal(first.includes('475878'), false);
});

test('team stable IDs are deterministic and entity-scoped', () => {
  const first = stableId('team', 'varzesh3', 87);
  const second = stableId('team', 'varzesh3', 87);

  assert.equal(first, second);
  assert.match(first, /^mp_team_[a-f0-9]{24}$/);
  assert.notEqual(first, stableId('match', 'varzesh3', 87));
});
