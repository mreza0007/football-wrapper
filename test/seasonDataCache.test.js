'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SEASON_CACHE_MAX_ENTRIES,
  DEFAULT_SEASON_MATCHES_CACHE_TTL_MS,
  DEFAULT_STANDINGS_CACHE_TTL_MS,
  createSeasonDataCache,
  normalizedCacheKey,
  seasonCacheConfig
} = require('../src/providers/varzesh3/seasonDataCache');
const {
  ProviderRequestError
} = require('../src/providers/varzesh3/httpClient');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('season cache configuration uses documented defaults and safe fallbacks', () => {
  assert.deepEqual(seasonCacheConfig({}), {
    matchesTtlMs: DEFAULT_SEASON_MATCHES_CACHE_TTL_MS,
    standingsTtlMs: DEFAULT_STANDINGS_CACHE_TTL_MS,
    maxEntries: DEFAULT_SEASON_CACHE_MAX_ENTRIES
  });
  assert.deepEqual(
    seasonCacheConfig({
      VARZESH3_SEASON_MATCHES_CACHE_TTL_MS: '-1',
      VARZESH3_STANDINGS_CACHE_TTL_MS: '1.5',
      VARZESH3_SEASON_CACHE_MAX_ENTRIES: '0'
    }),
    {
      matchesTtlMs: 30000,
      standingsTtlMs: 30000,
      maxEntries: 100
    }
  );
  assert.deepEqual(
    seasonCacheConfig({
      VARZESH3_SEASON_MATCHES_CACHE_TTL_MS: '0',
      VARZESH3_STANDINGS_CACHE_TTL_MS: '0',
      VARZESH3_SEASON_CACHE_MAX_ENTRIES: '2'
    }),
    { matchesTtlMs: 0, standingsTtlMs: 0, maxEntries: 2 }
  );
});

test('season matches cache returns fresh cached data', async () => {
  let calls = 0;
  const cache = createSeasonDataCache({
    matchesTtlMs: 100,
    fetchMatches: async () => ({ matches: [{ match: { id: ++calls } }] })
  });

  const first = await cache.getMatches('varzesh3', 3, 10);
  const second = await cache.getMatches('varzesh3', 3, 10);

  assert.equal(calls, 1);
  assert.deepEqual(second, first);
});

test('standings cache returns fresh cached data', async () => {
  let calls = 0;
  const cache = createSeasonDataCache({
    standingsTtlMs: 100,
    fetchStandings: async () => ({ teams: [{ id: ++calls }] })
  });

  await cache.getStandings('varzesh3', 3, 10);
  const second = await cache.getStandings('varzesh3', 3, 10);

  assert.equal(calls, 1);
  assert.deepEqual(second, { teams: [{ id: 1 }] });
});

test('matches and standings cache keys are isolated', async () => {
  let matchCalls = 0;
  let standingCalls = 0;
  const cache = createSeasonDataCache({
    fetchMatches: async () => ({ matches: [++matchCalls] }),
    fetchStandings: async () => ({ teams: [++standingCalls] })
  });

  await cache.getMatches('varzesh3', 3, 10);
  await cache.getStandings('varzesh3', 3, 10);
  await cache.getMatches('varzesh3', 3, 10);
  await cache.getStandings('varzesh3', 3, 10);

  assert.equal(matchCalls, 1);
  assert.equal(standingCalls, 1);
  assert.equal(cache.size(), 2);
});

test('season and provider cache keys are isolated', async () => {
  let calls = 0;
  const cache = createSeasonDataCache({
    fetchMatches: async (leagueId, seasonId) => ({
      matches: [{ leagueId, seasonId, call: ++calls }]
    })
  });

  await cache.getMatches('varzesh3', 3, 10);
  await cache.getMatches('varzesh3', 3, 11);
  await cache.getMatches('another-provider', 3, 10);
  await cache.getMatches('varzesh3', 3, 10);

  assert.equal(calls, 3);
  assert.equal(cache.size(), 3);
});

test('ten concurrent matches callers share one in-flight provider request', async () => {
  const gate = deferred();
  let calls = 0;
  const cache = createSeasonDataCache({
    fetchMatches: async () => {
      calls += 1;
      return gate.promise;
    }
  });

  const requests = Array.from({ length: 10 }, () =>
    cache.getMatches('varzesh3', 3, 10)
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  gate.resolve({ matches: [] });
  const results = await Promise.all(requests);

  assert.equal(calls, 1);
  assert.equal(results.length, 10);
});

test('concurrent standings callers share one in-flight provider request', async () => {
  const gate = deferred();
  let calls = 0;
  const cache = createSeasonDataCache({
    fetchStandings: async () => {
      calls += 1;
      return gate.promise;
    }
  });

  const first = cache.getStandings('varzesh3', 3, 10);
  const second = cache.getStandings('varzesh3', 3, 10);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  gate.resolve({ teams: [] });
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('cache TTL expiry triggers one shared refresh', async () => {
  let currentTime = 0;
  let calls = 0;
  const cache = createSeasonDataCache({
    now: () => currentTime,
    matchesTtlMs: 100,
    fetchMatches: async () => ({ matches: [++calls] })
  });

  await cache.getMatches('varzesh3', 3, 10);
  currentTime = 101;
  const [first, second] = await Promise.all([
    cache.getMatches('varzesh3', 3, 10),
    cache.getMatches('varzesh3', 3, 10)
  ]);

  assert.equal(calls, 2);
  assert.deepEqual(first, { matches: [2] });
  assert.deepEqual(second, first);
});

test('TTL zero disables reuse', async () => {
  let calls = 0;
  const cache = createSeasonDataCache({
    matchesTtlMs: 0,
    fetchMatches: async () => ({ matches: [++calls] })
  });

  await cache.getMatches('varzesh3', 3, 10);
  await cache.getMatches('varzesh3', 3, 10);
  assert.equal(calls, 2);
});

test('valid empty matches and standings are cached', async () => {
  let matchCalls = 0;
  let standingCalls = 0;
  const cache = createSeasonDataCache({
    fetchMatches: async () => {
      matchCalls += 1;
      return { matches: [], pagesFetched: 1, pageLimitReached: false };
    },
    fetchStandings: async () => {
      standingCalls += 1;
      return { teams: [] };
    }
  });

  await cache.getMatches('varzesh3', 3, 10);
  await cache.getMatches('varzesh3', 3, 10);
  await cache.getStandings('varzesh3', 3, 10);
  await cache.getStandings('varzesh3', 3, 10);

  assert.equal(matchCalls, 1);
  assert.equal(standingCalls, 1);
});

test('failed refresh preserves but does not serve expired cached data', async () => {
  let currentTime = 0;
  let shouldFail = false;
  const cachedValue = { matches: [{ match: { id: 101 } }] };
  const cache = createSeasonDataCache({
    now: () => currentTime,
    matchesTtlMs: 100,
    fetchMatches: async () => {
      if (shouldFail) {
        throw new ProviderRequestError('network');
      }
      return cachedValue;
    }
  });

  await cache.getMatches('varzesh3', 3, 10);
  currentTime = 101;
  shouldFail = true;
  await assert.rejects(
    cache.getMatches('varzesh3', 3, 10),
    ProviderRequestError
  );
  assert.deepEqual(cache.peek('matches', 'varzesh3', 3, 10), cachedValue);
  await assert.rejects(
    cache.getMatches('varzesh3', 3, 10),
    ProviderRequestError
  );
});

test('caller mutation cannot mutate cached or sibling data', async () => {
  const cache = createSeasonDataCache({
    fetchMatches: async () => ({ matches: [{ match: { id: 101 } }] })
  });

  const first = await cache.getMatches('varzesh3', 3, 10);
  const second = await cache.getMatches('varzesh3', 3, 10);
  first.matches[0].match.id = 999;
  second.matches.push({ match: { id: 102 } });
  const third = await cache.getMatches('varzesh3', 3, 10);

  assert.deepEqual(third, { matches: [{ match: { id: 101 } }] });
});

test('cache maximum size is bounded with deterministic LRU eviction', async () => {
  const calls = new Map();
  const cache = createSeasonDataCache({
    maxEntries: 2,
    fetchMatches: async (leagueId, seasonId) => {
      const key = `${leagueId}:${seasonId}`;
      calls.set(key, (calls.get(key) || 0) + 1);
      return { matches: [{ key }] };
    }
  });

  await cache.getMatches('varzesh3', 3, 10);
  await cache.getMatches('varzesh3', 3, 11);
  await cache.getMatches('varzesh3', 3, 10);
  await cache.getMatches('varzesh3', 3, 12);

  assert.equal(cache.size(), 2);
  assert.deepEqual(cache.keys(), [
    normalizedCacheKey('varzesh3', 'matches', 3, 10),
    normalizedCacheKey('varzesh3', 'matches', 3, 12)
  ]);
  await cache.getMatches('varzesh3', 3, 11);
  assert.equal(calls.get('3:11'), 2);
  assert.equal(cache.size(), 2);
});
