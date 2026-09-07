'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const provider = require('../src/providers/varzesh3');
const live = require('../src/providers/varzesh3/liveData');
const service = require('../src/services/dailyMatchService');
const { ProviderRequestError } = require('../src/providers/varzesh3/httpClient');
const stableId = require('../src/utils/stableId');
const now = () => Date.parse('2026-09-07T12:00:00Z');

function record(id, league = 3, startOnUtc = '2026-09-07T12:00:00Z') {
  return {
    id, provider_league_id: league, provider_sport: 1, startOnUtc, status: 0,
    date: 'wrong provider date', host: { id: 101, name: 'Home', logo: 'home.png' },
    guest: { id: 202, name: 'Away', logo: 'away.png' },
    goals: { host: 0, guest: 0 }, _links: [{ href: 'private-url' }], secret: 'private'
  };
}

test('only the five verified offsets can construct provider URLs', async () => {
  for (const offset of [-2, -1, 0, 1, 2]) {
    const urls = [];
    assert.deepEqual(await live.fetchLivescoreByOffset(offset, {
      requestJson: async url => { urls.push(url); return []; }
    }), []);
    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0]).pathname, '/v2.0/livescore/' + (offset === 0 ? 'today' : offset));
  }
  for (const offset of [3, -3, 'today', '../matches', 0.5, null]) {
    await assert.rejects(live.fetchLivescoreByOffset(offset, {
      requestJson: () => assert.fail('invalid offset fetched')
    }), RangeError);
  }
});

test('date mapping is based on Tehran midnight with strict calendar validation', () => {
  for (const [date, expected] of [['2026-09-05', -2], ['2026-09-06', -1],
    ['2026-09-07', 0], ['2026-09-08', 1], ['2026-09-09', 2]]) {
    assert.equal(service.dateOffset(date, now()), expected);
  }
  assert.equal(service.dateOffset('2026-09-08', Date.parse('2026-09-07T20:30:00Z')), 0);
  for (const date of [undefined, ['2026-09-07'], '2026-9-7', ' 2026-09-07', '2026-02-30',
    '2026-09-04', '2026-09-10']) {
    assert.throws(() => service.dateOffset(date, now()), error => error.status === 400);
  }
});

test('daily grouping keeps >5 matches, canonical identities and registry order without season work', async t => {
  const rows = [record(90, 2), ...Array.from({ length: 10 }, (_, i) => record(i + 1)),
    record(91, 6), record(92, 9999), record(1), record(93, 3, '2026-09-07T10:00:00Z')];
  t.mock.method(provider, 'getLivescoreByOffset', async offset => {
    assert.equal(offset, 0);
    return rows;
  });
  for (const name of ['getSeasonMatches', 'fetchSeasonMatches', 'fetchSeasonOverviewMatches', 'getSeasonStandings']) {
    t.mock.method(provider, name, () => assert.fail('unexpected season work'));
  }
  const result = await service.getMatchesByDate('2026-09-07', { now });
  assert.deepEqual(Object.keys(result), ['date', 'groups', 'errors']);
  assert.deepEqual(result.groups.map(g => g.competition.key),
    ['premier_league', 'persian_gulf_pro_league', 'la_liga']);
  assert.equal(result.groups[0].matches.length, 11);
  const first = result.groups[0].matches[0];
  assert.equal(first.id, stableId('match', 'varzesh3', 93));
  assert.equal(first.home_team_id, stableId('team', 'varzesh3', 101));
  assert.equal(first.away_team_id, stableId('team', 'varzesh3', 202));
  assert.equal(first.home_score, 0);
  assert.equal(first.is_upcoming, true);
  assert.equal(result.groups[1].competition.season_key, '1405-1406');
  for (const field of ['provider', 'external_match_id', 'home_external_team_id',
    'away_external_team_id', 'provider_league_id', '_links', 'secret']) {
    assert.equal(Object.hasOwn(first, field), false);
  }
  assert.equal(JSON.stringify(result).includes('private-url'), false);
});

test('all eight mapped football leagues use configured seasons; other sports are excluded', async t => {
  const keys = require('../src/config/competitionRegistry').competitions.map(c => c.competition_key);
  t.mock.method(provider, 'getLivescoreByOffset', async () => keys.map((key, i) =>
    record(i + 1, provider.getCompetitionMapping(key).provider_league_id))
    .concat({ ...record(100), provider_sport: 2 }));
  const result = await service.getMatchesByDate('2026-09-07', { now });
  assert.deepEqual(result.groups.map(g => g.competition.key), keys);
  assert.equal(result.groups.flatMap(g => g.matches).length, 8);
});

test('startOnUtc alone controls inclusion across Tehran midnight and ignores bad kickoff rows', async t => {
  const crossing = record(2, 3, '2026-09-07T20:30:00Z');
  t.mock.method(provider, 'getLivescoreByOffset', async () => [
    record(1, 3, '2026-09-07T20:29:59Z'), crossing,
    record(3, 3, '2026-09-07T23:59:59'), record(4, 3, null),
    record(5, 3, '2026-02-30T12:00:00Z'), record(6, 3, 'garbage'),
    { ...record(7, 3, null), utcTime: '2026-09-07T12:00:00Z', time: '12:00' },
    record(8, 3, '2026-09-07T24:00:00Z')
  ]);
  const today = await service.getMatchesByDate('2026-09-07', { now });
  const tomorrow = await service.getMatchesByDate('2026-09-08', { now });
  assert.deepEqual(today.groups[0].matches.map(m => m.id), [stableId('match', 'varzesh3', 1)]);
  assert.deepEqual(tomorrow.groups[0].matches.map(m => m.id), [stableId('match', 'varzesh3', 2)]);
  assert.equal(service.dailyKickoff('2026-09-07T23:59:59+03:30'), '2026-09-07T20:29:59.000Z');
});

test('unsupported statuses and malformed identities are skipped; finished/live flags remain correct', async t => {
  t.mock.method(provider, 'getLivescoreByOffset', async () => [
    null, {}, record({ bad: 1 }), { ...record(1), status: 99 },
    { ...record(2), status: 7 }, { ...record(3), status: 2 }
  ]);
  const result = await service.getMatchesByDate('2026-09-07', { now });
  assert.equal(result.groups[0].matches.length, 2);
  assert.equal(result.groups[0].matches.find(m => m.status === 'finished').is_finished, true);
  assert.equal(result.groups[0].matches.find(m => m.status === 'live').is_live, true);
});

test('ambiguous league mapping is excluded', async t => {
  const original = provider.getCompetitionMapping;
  t.mock.method(provider, 'getCompetitionMapping', key => ({
    ...original(key), provider_league_id: 3
  }));
  t.mock.method(provider, 'getLivescoreByOffset', async () => [record(1)]);
  assert.deepEqual((await service.getMatchesByDate('2026-09-07', { now })).groups, []);
});

test('HTTP invalid and out-of-window dates fail without a fetch; valid empty returns exact envelope', async t => {
  let calls = 0;
  t.mock.method(provider, 'getLivescoreByOffset', async () => { calls++; return []; });
  for (const query of ['', '?date=2026-02-30', '?date=2000-01-01', '?date=2026-09-07&date=2026-09-08']) {
    await request(app).get('/matches/by-date' + query).expect(400);
  }
  assert.equal(calls, 0);
  const date = service.tehranDate(Date.now());
  const response = await request(app).get('/matches/by-date?date=' + date).expect(200);
  assert.deepEqual(response.body, { date, groups: [], errors: [] });
});

test('HTTP provider failure is sanitized and never falls back', async t => {
  t.mock.method(provider, 'getLivescoreByOffset', async () => { throw new ProviderRequestError('private secret'); });
  t.mock.method(provider, 'getSeasonMatches', () => assert.fail('fallback'));
  const response = await request(app).get('/matches/by-date?date=' + service.tehranDate(Date.now())).expect(502);
  assert.deepEqual(response.body, { ok: false, error: 'Provider unavailable' });
});

test('malformed provider root fails instead of caching empty success; valid empty root works', async () => {
  await assert.rejects(live.fetchLivescoreByOffset(0, { requestJson: async () => ({ error: 'secret' }) }), ProviderRequestError);
  assert.deepEqual(await live.fetchTodayLivescore({ requestJson: async () => [] }), []);
});

test('flattening preserves authoritative parent league identity and deduplicates', () => {
  const rows = live.flattenTodayLivescore([{ id: 3, sport: 1, dates: [{
    matches: [{ ...record(1), provider_league_id: 999 }, record(1)]
  }] }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider_league_id, 3);
});

test('offset cache shares requests, isolates offsets, clones data and expires', async () => {
  let clock = now();
  let calls = 0;
  const cache = live.createOffsetLivescoreCache({
    now: () => clock, ttlMs: 10,
    fetchMatches: async offset => { calls++; return [{ id: offset }]; }
  });
  const [a, b] = await Promise.all([cache.get(0), cache.get(0)]);
  a[0].id = 999;
  assert.equal(b[0].id, 0);
  assert.equal((await cache.get())[0].id, 0);
  assert.equal(calls, 1);
  await cache.get(1);
  assert.equal(calls, 2);
  clock += 11;
  await cache.get(0);
  assert.equal(calls, 3);
  assert.throws(() => cache.get(99), RangeError);
});

test('offset cache invalidates at Tehran midnight even within TTL', async () => {
  let clock = Date.parse('2026-09-07T20:29:59Z');
  let calls = 0;
  const cache = live.createOffsetLivescoreCache({
    now: () => clock, fetchMatches: async () => [{ id: ++calls }]
  });
  assert.equal((await cache.get())[0].id, 1);
  clock += 1000;
  assert.equal((await cache.get())[0].id, 2);
});

test('failed offset refresh does not serve expired data and can recover', async () => {
  let clock = now();
  let fail = false;
  const cache = live.createOffsetLivescoreCache({
    now: () => clock, ttlMs: 10,
    fetchMatches: async () => { if (fail) throw new ProviderRequestError('network'); return [record(1)]; }
  });
  await cache.get(1);
  clock += 11;
  fail = true;
  await assert.rejects(cache.get(1), ProviderRequestError);
  fail = false;
  assert.equal((await cache.get(1)).length, 1);
});

test('request crossing Tehran midnight fails rather than using a shifted offset', async t => {
  let clock = Date.parse('2026-09-07T20:29:59Z');
  t.mock.method(provider, 'getLivescoreByOffset', async () => { clock += 1000; return []; });
  await assert.rejects(service.getMatchesByDate('2026-09-07', { now: () => clock }),
    error => error.status === 502);
});

test('today compatibility helper and offset zero share the default cache', async t => {
  live.clearLivescoreCache();
  t.after(() => live.clearLivescoreCache());
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return {
      ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => [{ id: 3, sport: 1, dates: [{ matches: [record(1)] }] }]
    };
  });
  const [today, offsetZero] = await Promise.all([
    live.getTodayLivescore(), live.getLivescoreByOffset(0)
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(today, offsetZero);
  today[0].host.name = 'changed';
  assert.equal(offsetZero[0].host.name, 'Home');
});
