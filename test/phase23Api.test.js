'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const varzesh3 = require('../src/providers/varzesh3');

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  varzesh3.clearSeasonDataCache();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  varzesh3.clearSeasonDataCache();
});

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => structuredClone(body)
  };
}

function matchesPage(host = {}) {
  return {
    _links: [],
    items: [
      {
        round: 1,
        dates: [
          {
            date: '1405/05/30',
            matches: [
              {
                id: 101,
                status: 1,
                host: {
                  id: 87,
                  name: 'نام مسابقه آرسنال',
                  logo: 'match.png',
                  ...host
                },
                guest: { id: 90, name: 'لیورپول', logo: 'liverpool.png' }
              }
            ]
          }
        ]
      }
    ]
  };
}

function standingPayload(team = {}) {
  return {
    teams: [
      {
        rank: 1,
        id: 87,
        name: 'آرسنال',
        logo: 'standing.png',
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        goalFor: 0,
        goalAgainst: 0,
        goalDifference: 0,
        hasLiveMatch: false,
        ...team
      }
    ]
  };
}

function routeFetch({ standing = standingPayload(), matches = matchesPage() } = {}) {
  return async (url) =>
    url.endsWith('/standing') ? response(standing) : response(matches);
}

function hasPrivateMapping(value) {
  const serialized = JSON.stringify(value);
  return (
    serialized.includes('provider_league_id') ||
    serialized.includes('provider_season_id')
  );
}

test('teams endpoint returns standings-authoritative normalized teams', async () => {
  globalThis.fetch = routeFetch();

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(200);

  assert.equal(result.body.ok, true);
  assert.equal(result.body.count, 1);
  assert.deepEqual(result.body.warnings, []);
  assert.deepEqual(Object.keys(result.body.teams[0]).sort(), [
    'competition_key',
    'external_team_id',
    'id',
    'logo',
    'name_en',
    'name_fa',
    'provider',
    'season_key',
    'warnings'
  ]);
  assert.equal(result.body.teams[0].name_fa, 'آرسنال');
  assert.equal(result.body.teams[0].logo, 'standing.png');
  assert.equal(result.body.teams[0].name_en, null);
  assert.equal(hasPrivateMapping(result.body), false);
});

test('standing-derived team ID equals the standings endpoint stable ID', async () => {
  globalThis.fetch = routeFetch();
  const teams = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(200);
  const standings = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/standings')
    .expect(200);

  assert.equal(teams.body.teams[0].id, standings.body.standings[0].team_id);
});

test('missing standings falls back to matches with matching stable team IDs', async () => {
  globalThis.fetch = async (url) =>
    url.endsWith('/standing') ? response({}, 404) : response(matchesPage());

  const teams = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(200);
  const matches = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/matches')
    .expect(200);

  const team = teams.body.teams.find((item) => item.external_team_id === 87);
  assert.equal(team.id, matches.body.matches[0].home_team_id);
  assert.ok(
    teams.body.warnings.includes(
      'standings_unavailable_teams_derived_from_matches'
    )
  );
});

test('provider standings failure with valid matches still returns teams', async () => {
  globalThis.fetch = async (url) => {
    if (url.endsWith('/standing')) {
      throw new TypeError('standing network failure');
    }
    return response(matchesPage());
  };

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(200);

  assert.equal(result.body.count, 2);
  assert.ok(
    result.body.warnings.includes(
      'standings_unavailable_teams_derived_from_matches'
    )
  );
});

test('matches failure with valid standings still returns standings teams', async () => {
  globalThis.fetch = async (url) => {
    if (!url.endsWith('/standing')) {
      throw new TypeError('matches network failure');
    }
    return response(standingPayload());
  };

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(200);

  assert.equal(result.body.count, 1);
  assert.equal(result.body.teams[0].name_fa, 'آرسنال');
  assert.deepEqual(result.body.warnings, []);
});

test('unresolved match-derived identity remains null with record and top warnings', async () => {
  globalThis.fetch = async (url) =>
    url.endsWith('/standing')
      ? response({}, 404)
      : response(
          matchesPage({ id: 0, name: 'ناشناخته', logo: 'unknown.png' })
        );

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(200);
  const unresolved = result.body.teams.find(
    (team) => team.name_fa === 'ناشناخته'
  );

  assert.equal(unresolved.id, null);
  assert.equal(unresolved.external_team_id, null);
  assert.ok(unresolved.warnings.includes('team_identity_unresolved'));
  assert.ok(result.body.warnings.includes('unresolved_team_identities:1'));
});

test('both provider sources failing returns a safe 502', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('private provider detail');
  };

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(502);

  assert.deepEqual(result.body, { ok: false, error: 'Provider unavailable' });
  assert.equal(JSON.stringify(result.body).includes('private'), false);
});

test('teams endpoint preserves competition and season 404 responses', async () => {
  await request(app)
    .get('/competitions/unknown/seasons/2026-2027/teams')
    .expect(404, { ok: false, error: 'Competition not found' });
  await request(app)
    .get('/competitions/premier_league/seasons/unknown/teams')
    .expect(404, { ok: false, error: 'Season not found' });
});

test('empty standings fall back to matches with the matches endpoint stable IDs', async () => {
  globalThis.fetch = routeFetch({ standing: { teams: [] } });

  const teams = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/teams')
    .expect(200);
  const matches = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/matches')
    .expect(200);
  const arsenal = teams.body.teams.find(
    (team) => team.external_team_id === 87
  );

  assert.equal(teams.body.count, 2);
  assert.ok(
    teams.body.warnings.includes(
      'standings_unavailable_teams_derived_from_matches'
    )
  );
  assert.equal(arsenal.id, matches.body.matches[0].home_team_id);
});
