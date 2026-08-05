'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderRequestError } = require('../src/providers/varzesh3/httpClient');
const {
  createLivescoreCache,
  flattenTodayLivescore
} = require('../src/providers/varzesh3/liveData');

test('today livescore leagues and dates are flattened and duplicate IDs removed', () => {
  const result = flattenTodayLivescore([
    {
      dates: [
        { date: '1405/05/30', matches: [{ id: 1 }, { id: 2 }] },
        { date: '1405/05/31', matches: [{ id: '1' }, { id: '' }] }
      ]
    },
    { dates: [{ date: '1405/05/30', matches: [{ id: 3 }] }] }
  ]);

  assert.deepEqual(
    result.map((match) => String(match.id)),
    ['1', '2', '3']
  );
  assert.equal(result[0].date, '1405/05/30');
});

test('today livescore supports a safe leagues wrapper root', () => {
  const result = flattenTodayLivescore({
    leagues: [{ dates: [{ matches: [{ id: 7 }] }] }]
  });
  assert.equal(result[0].id, 7);
});

test('livescore cache shares one in-flight refresh', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const cache = createLivescoreCache({
    fetchMatches: async () => {
      calls += 1;
      await gate;
      return [{ id: 1 }];
    }
  });

  const first = cache.get();
  const second = cache.get();
  release();
  const [left, right] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(left, right);
});

test('provider failure does not replace a previously valid non-empty cache', async () => {
  let currentTime = 0;
  let fail = false;
  const cache = createLivescoreCache({
    now: () => currentTime,
    ttlMs: 10,
    fetchMatches: async () => {
      if (fail) {
        throw new ProviderRequestError('network');
      }
      return [{ id: 1 }];
    }
  });

  await cache.get();
  currentTime = 11;
  fail = true;
  await assert.rejects(cache.get(), ProviderRequestError);
  assert.deepEqual(cache.peek(), [{ id: 1 }]);
});

test('clearing the cache prevents an older in-flight refresh from repopulating it', async () => {
  let calls = 0;
  const releases = [];
  const cache = createLivescoreCache({
    fetchMatches: async () => {
      calls += 1;
      const call = calls;
      await new Promise((resolve) => {
        releases[call] = resolve;
      });
      return [{ id: call }];
    }
  });

  const oldRefresh = cache.get();
  cache.clear();
  const newRefresh = cache.get();
  releases[1]();
  releases[2]();
  await Promise.all([oldRefresh, newRefresh]);

  assert.deepEqual(cache.peek(), [{ id: 2 }]);
});
