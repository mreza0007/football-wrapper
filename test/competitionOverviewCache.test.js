'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCompetitionOverviewCache,
  overviewCacheKey
} = require('../src/services/competitionOverviewCache');

test('overview cache returns defensive copies on a fresh hit', async () => {
  let calls = 0;
  const cache = createCompetitionOverviewCache({ ttlMs: 100 });
  const fetcher = async () => {
    calls += 1;
    return { matches: [{ id: 'one' }] };
  };

  const first = await cache.get('premier_league', '2026-2027', fetcher);
  first.matches[0].id = 'mutated';
  const second = await cache.get('premier_league', '2026-2027', fetcher);

  assert.equal(calls, 1);
  assert.equal(second.matches[0].id, 'one');
});

test('concurrent cold overview requests coalesce by exact scope', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const cache = createCompetitionOverviewCache();
  const fetcher = async () => {
    calls += 1;
    await gate;
    return { matches: [] };
  };

  const requests = Array.from({ length: 10 }, () =>
    cache.get('premier_league', '2026-2027', fetcher)
  );
  release();
  await Promise.all(requests);
  assert.equal(calls, 1);
});

test('overview cache isolates competitions and seasons', async () => {
  let calls = 0;
  const cache = createCompetitionOverviewCache();
  const fetcher = async () => ({ value: ++calls });

  const premier = await cache.get('premier_league', '2026-2027', fetcher);
  const laLiga = await cache.get('la_liga', '2026-2027', fetcher);
  const otherSeason = await cache.get('premier_league', '2027-2028', fetcher);

  assert.deepEqual([premier.value, laLiga.value, otherSeason.value], [1, 2, 3]);
  assert.equal(cache.size(), 3);
  assert.notEqual(
    overviewCacheKey('premier_league', '2026-2027'),
    overviewCacheKey('la_liga', '2026-2027')
  );
});

test('expired overview refreshes synchronously and does not serve stale data', async () => {
  let currentTime = 0;
  let calls = 0;
  const cache = createCompetitionOverviewCache({
    ttlMs: 10,
    now: () => currentTime
  });
  await cache.get('premier_league', '2026-2027', async () => ({
    value: ++calls
  }));
  currentTime = 11;

  await assert.rejects(
    cache.get('premier_league', '2026-2027', async () => {
      throw new Error('provider failed');
    }),
    /provider failed/
  );
  assert.equal(calls, 1);
});

test('overview cache evicts the least-recently-used entry at its bound', async () => {
  const cache = createCompetitionOverviewCache({ maxEntries: 2 });
  const fetcher = async () => ({ matches: [] });

  await cache.get('premier_league', '2026-2027', fetcher);
  await cache.get('la_liga', '2026-2027', fetcher);
  await cache.get('serie_a', '2026-2027', fetcher);

  assert.equal(cache.size(), 2);
});
