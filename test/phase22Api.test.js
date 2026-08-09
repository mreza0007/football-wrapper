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

function response(body, status = 200, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => structuredClone(body)
  };
}

function matchesPage() {
  return {
    hasPrev: false,
    hasMore: false,
    _links: [],
    items: [
      {
        round: 1,
        dates: [
          {
            date: '۱۴۰۵/۰۵/۱۰',
            utcTime: '0001-01-01T00:00:00',
            matches: [
              {
                id: 101,
                time: '18:00',
                status: 1,
                isLive: false,
                host: { id: 87, name: 'آرسنال', logo: 'a.png' },
                guest: { id: 90, name: 'لیورپول', logo: 'l.png' }
              },
              {
                id: 102,
                time: '20:00',
                status: 7,
                isLive: false,
                goals: { host: 0, guest: 2 },
                host: { id: 91, name: 'چلسی', logo: 'c.png' },
                guest: { id: 92, name: 'سیتی', logo: 'm.png' }
              }
            ]
          }
        ]
      }
    ]
  };
}

function standingPayload() {
  return {
    teams: [
      {
        rank: 1,
        id: 87,
        name: 'آرسنال',
        logo: 'a.png',
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        goalFor: 0,
        goalAgainst: 0,
        goalDifference: 0,
        qualificationColor: '#00f',
        hasLiveMatch: false
      }
    ]
  };
}

function assertNoPrivateMapping(value) {
  const json = JSON.stringify(value);
  assert.equal(json.includes('provider_league_id'), false);
  assert.equal(json.includes('provider_season_id'), false);
}

test('matches endpoint returns only normalized public data', async () => {
  globalThis.fetch = async () => response(matchesPage());

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/matches')
    .expect(200);

  assert.equal(result.body.ok, true);
  assert.equal(result.body.count, 2);
  assert.equal(result.body.matches[0].provider, 'varzesh3');
  assert.equal(result.body.matches[0].home_name_en, null);
  assert.equal(result.body.matches[0].kickoff_utc, null);
  assert.equal(result.body.matches[1].home_score, 0);
  assertNoPrivateMapping(result.body);
});

test('matches status filter returns only matching normalized statuses', async () => {
  globalThis.fetch = async () => response(matchesPage());

  const result = await request(app)
    .get(
      '/competitions/premier_league/seasons/2026-2027/matches?status=finished'
    )
    .expect(200);

  assert.equal(result.body.count, 1);
  assert.equal(result.body.matches[0].status, 'finished');
});

test('invalid match status filter returns the required 400 response', async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return response(matchesPage());
  };

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/matches?status=cancelled')
    .expect(400);

  assert.deepEqual(result.body, { ok: false, error: 'Invalid status' });
  assert.equal(called, false);
});

test('standings endpoint returns normalized rows without provider mappings', async () => {
  globalThis.fetch = async () => response(standingPayload());

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/standings')
    .expect(200);

  assert.equal(result.body.ok, true);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.standings[0].team_fa, 'آرسنال');
  assert.equal(result.body.standings[0].team_en, null);
  assert.equal(result.body.standings[0].played, 0);
  assertNoPrivateMapping(result.body);
});

test('provider network failure returns a safe 502 response', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('sensitive network detail');
  };

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/matches')
    .expect(502);

  assert.deepEqual(result.body, { ok: false, error: 'Provider unavailable' });
  assert.equal(JSON.stringify(result.body).includes('sensitive'), false);
});

test('unavailable standings return the required 501 response', async () => {
  globalThis.fetch = async () => response({}, 404);

  const result = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/standings')
    .expect(501);

  assert.deepEqual(result.body, {
    ok: false,
    error: 'Standings not available'
  });
});

test('data endpoints preserve competition and season 404 behavior', async () => {
  await request(app)
    .get('/competitions/unknown/seasons/2026-2027/matches')
    .expect(404, { ok: false, error: 'Competition not found' });
  await request(app)
    .get('/competitions/premier_league/seasons/unknown/standings')
    .expect(404, { ok: false, error: 'Season not found' });
});
