'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const stableId = require('../src/utils/stableId');
const {
  MatchLookupProviderError,
  MatchNotFoundError,
  createMatchLocator
} = require('../src/services/matchLocatorService');

function snapshot(externalId = 101, name = 'آرسنال') {
  return {
    id: stableId('match', 'varzesh3', externalId),
    competition_key: 'premier_league',
    season_key: '2026-2027',
    provider: 'varzesh3',
    external_match_id: externalId,
    home_name_fa: name,
    warnings: []
  };
}

test('stable match ID resolves through an already populated index', async () => {
  const locator = createMatchLocator({ loadMatches: async () => ({ matches: [] }) });
  const match = snapshot();
  locator.indexMatches([match]);

  const result = await locator.resolve(match.id);
  assert.equal(result.external_match_id, 101);
  assert.deepEqual(result.snapshot, match);
});

test('raw numeric and malformed match IDs are rejected without refreshing', async () => {
  let builds = 0;
  const locator = createMatchLocator({
    loadMatches: async () => {
      builds += 1;
      return { matches: [] };
    }
  });

  await assert.rejects(locator.resolve('101'), MatchNotFoundError);
  await assert.rejects(locator.resolve('mp_match_bad'), MatchNotFoundError);
  await assert.rejects(locator.resolve(''), MatchNotFoundError);
  await assert.rejects(
    locator.resolve(` ${stableId('match', 'varzesh3', 101)} `),
    MatchNotFoundError
  );
  assert.equal(builds, 0);
});

test('index miss populates from refreshed season match snapshots', async () => {
  const match = snapshot();
  const locator = createMatchLocator({
    loadMatches: async () => ({ matches: [match], providerFailure: false })
  });

  const result = await locator.resolve(match.id);
  assert.equal(result.snapshot.id, match.id);
});

test('concurrent misses share one index refresh', async () => {
  const match = snapshot();
  let builds = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const locator = createMatchLocator({
    loadMatches: async () => {
      builds += 1;
      await gate;
      return { matches: [match], providerFailure: false };
    }
  });

  const first = locator.resolve(match.id);
  const second = locator.resolve(match.id);
  release();
  const [left, right] = await Promise.all([first, second]);

  assert.equal(builds, 1);
  assert.equal(left.snapshot.id, right.snapshot.id);
});

test('index TTL expiration causes a lazy refresh', async () => {
  let currentTime = 0;
  let builds = 0;
  const match = snapshot();
  const locator = createMatchLocator({
    now: () => currentTime,
    ttlMs: 100,
    loadMatches: async () => {
      builds += 1;
      return { matches: [snapshot(101, `نسخه ${builds}`)] };
    }
  });
  locator.indexMatches([match]);

  assert.equal((await locator.resolve(match.id)).snapshot.home_name_fa, 'آرسنال');
  currentTime = 101;
  assert.equal((await locator.resolve(match.id)).snapshot.home_name_fa, 'نسخه 1');
  assert.equal(builds, 1);
});

test('unknown stable match ID returns not found after successful refresh', async () => {
  const locator = createMatchLocator({
    loadMatches: async () => ({ matches: [snapshot()] })
  });

  await assert.rejects(
    locator.resolve(stableId('match', 'varzesh3', 999)),
    MatchNotFoundError
  );
});

test('provider failure while refreshing the index returns provider unavailable', async () => {
  const locator = createMatchLocator({
    loadMatches: async () => ({ matches: [], providerFailure: true })
  });

  await assert.rejects(
    locator.resolve(stableId('match', 'varzesh3', 999)),
    MatchLookupProviderError
  );
});
