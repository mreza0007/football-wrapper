'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const varzesh3 = require('../src/providers/varzesh3');
const matchLocatorService = require('../src/services/matchLocatorService');
const overviewService = require('../src/services/competitionOverviewService');
const { ProviderRequestError } = require('../src/providers/varzesh3/httpClient');
const stableId = require('../src/utils/stableId');

const originalFetchOverview = varzesh3.fetchSeasonOverviewMatches;
const originalIndexMatches = matchLocatorService.indexMatches;
const originalReplaceScope = matchLocatorService.replaceMatchScope;

function rawEntry(id, status, kickoff) {
  return {
    round: 'round 1',
    date: { date: '1405/06/10' },
    match: {
      id,
      status,
      utcTime: kickoff,
      host: { id: 1000 + id, name: `Home ${id}` },
      guest: { id: 2000 + id, name: `Away ${id}` }
    }
  };
}

test.beforeEach(() => {
  overviewService.clearCompetitionOverviewCache();
  matchLocatorService.clearMatchIndex();
});

test.afterEach(() => {
  varzesh3.fetchSeasonOverviewMatches = originalFetchOverview;
  matchLocatorService.indexMatches = originalIndexMatches;
  matchLocatorService.replaceMatchScope = originalReplaceScope;
  overviewService.clearCompetitionOverviewCache();
  matchLocatorService.clearMatchIndex();
});

test('overview returns deterministic canonical safe matches and indexes them partially', async () => {
  const entries = [
    rawEntry(1, 2, null),
    rawEntry(2, 1, '2026-09-04T12:00:00Z'),
    rawEntry(3, 1, '2026-09-03T12:00:00Z'),
    rawEntry(4, 1, 'not-a-date'),
    rawEntry(5, 7, '2026-08-30T12:00:00Z'),
    rawEntry(6, 7, '2026-08-31T12:00:00Z'),
    rawEntry(7, 1, '2026-09-05T12:00:00')
  ];
  varzesh3.fetchSeasonOverviewMatches = async () => ({
    matches: entries,
    pagesFetched: 1,
    pageLimitReached: false
  });
  let indexed = 0;
  let replaced = 0;
  matchLocatorService.indexMatches = (matches) => {
    indexed += matches.length;
    return originalIndexMatches(matches);
  };
  matchLocatorService.replaceMatchScope = () => {
    replaced += 1;
  };

  const response = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/overview')
    .expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.stale, false);
  assert.deepEqual(
    response.body.matches.map((match) => match.id),
    [
      stableId('match', 'varzesh3', 1),
      stableId('match', 'varzesh3', 3),
      stableId('match', 'varzesh3', 2),
      stableId('match', 'varzesh3', 6),
      stableId('match', 'varzesh3', 5)
    ]
  );
  assert.equal(response.body.matches.some((match) => match.id === stableId('match', 'varzesh3', 4)), false);
  const serialized = JSON.stringify(response.body);
  for (const field of [
    'provider_league_id',
    'provider_season_id',
    'external_match_id',
    'home_external_team_id',
    'away_external_team_id'
  ]) {
    assert.equal(serialized.includes(field), false);
  }
  assert.equal(indexed, 5);
  assert.equal(
    response.body.matches.some(
      (match) => match.id === stableId('match', 'varzesh3', 7)
    ),
    false
  );
  assert.equal(
    response.body.matches.some((match) => Object.hasOwn(match, 'provider')),
    false
  );
  assert.equal(replaced, 0);

  const located = await matchLocatorService.resolveMatch(
    stableId('match', 'varzesh3', 3)
  );
  assert.equal(located.competition_key, 'premier_league');
  assert.equal(located.season_key, '2026-2027');
});

test('overview uses the same canonical IDs as full-season normalization', async () => {
  const entry = rawEntry(101, 1, '2026-09-10T12:00:00Z');
  varzesh3.fetchSeasonOverviewMatches = async () => ({
    matches: [entry],
    pagesFetched: 1,
    pageLimitReached: false
  });

  const response = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/overview')
    .expect(200);
  const fullNormalized = varzesh3.normalizeMatches(
    [entry],
    { competitionKey: 'premier_league', seasonKey: '2026-2027' }
  ).matches[0];

  assert.equal(response.body.matches[0].id, fullNormalized.id);
  assert.equal(
    response.body.matches[0].home_team_id,
    fullNormalized.home_team_id
  );
  assert.equal(
    response.body.matches[0].away_team_id,
    fullNormalized.away_team_id
  );
});

test('overview returns a sanitized 502 when provider retrieval fails', async () => {
  varzesh3.fetchSeasonOverviewMatches = async () => {
    throw new ProviderRequestError('network');
  };

  const response = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/overview')
    .expect(502);
  assert.deepEqual(response.body, { ok: false, error: 'Provider unavailable' });
});

test('valid empty overview returns 200 and unknown scopes return 404', async () => {
  let calls = 0;
  varzesh3.fetchSeasonOverviewMatches = async () => {
    calls += 1;
    return { matches: [], pagesFetched: 1, pageLimitReached: false };
  };

  const empty = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/overview')
    .expect(200);
  assert.equal(empty.body.count, 0);
  assert.deepEqual(empty.body.matches, []);

  await request(app)
    .get('/competitions/unknown/seasons/2026-2027/overview')
    .expect(404);
  await request(app)
    .get('/competitions/premier_league/seasons/unknown/overview')
    .expect(404);
  assert.equal(calls, 1);
});

test('overview selection caps categories and uses canonical ID tie breaks', () => {
  const kickoff = '2026-09-10T12:00:00Z';
  const matches = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `mp_match_${String(20 - index).padStart(24, '0')}`,
      status: 'upcoming',
      kickoff_utc: kickoff
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `mp_match_${String(40 - index).padStart(24, '0')}`,
      status: 'finished',
      kickoff_utc: kickoff
    })),
    {
      id: 'mp_match_000000000000000000000001',
      status: 'live',
      kickoff_utc: null
    }
  ];

  const selected = overviewService.selectOverviewMatches(matches);
  assert.equal(selected.filter((match) => match.status === 'live').length, 1);
  assert.equal(selected.filter((match) => match.status === 'upcoming').length, 5);
  assert.equal(selected.filter((match) => match.status === 'finished').length, 5);
  assert.deepEqual(
    selected
      .filter((match) => match.status === 'upcoming')
      .map((match) => match.id),
    [...matches.slice(0, 6).map((match) => match.id)].sort().slice(0, 5)
  );
});

test('overview endpoint cache avoids another provider call', async () => {
  let calls = 0;
  varzesh3.fetchSeasonOverviewMatches = async () => {
    calls += 1;
    return {
      matches: [rawEntry(301, 1, '2026-09-20T12:00:00Z')],
      pagesFetched: 1,
      pageLimitReached: false
    };
  };

  await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/overview')
    .expect(200);
  await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/overview')
    .expect(200);
  assert.equal(calls, 1);
});
