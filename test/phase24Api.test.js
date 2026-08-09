'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const stableId = require('../src/utils/stableId');
const varzesh3 = require('../src/providers/varzesh3');
const matchLocatorService = require('../src/services/matchLocatorService');
const { matchesExternalId } = require('../src/services/liveMatchService');

const originalFetch = globalThis.fetch;
const originalGetTodayLivescore = varzesh3.getTodayLivescore;

test.beforeEach(() => {
  matchLocatorService.clearMatchIndex();
  varzesh3.clearSeasonDataCache();
  varzesh3.clearLivescoreCache();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  varzesh3.getTodayLivescore = originalGetTodayLivescore;
  matchLocatorService.clearMatchIndex();
  varzesh3.clearSeasonDataCache();
  varzesh3.clearLivescoreCache();
});

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => structuredClone(body)
  };
}

function seasonPage() {
  return {
    _links: [],
    items: [
      {
        round: 'هفته 1',
        dates: [
          {
            date: '1405/05/30',
            utcTime: '0001-01-01T00:00:00',
            matches: [
              {
                id: 101,
                time: '22:30',
                status: 1,
                isLive: false,
                host: { id: 87, name: 'آرسنال', logo: 'arsenal.png' },
                guest: { id: 90, name: 'لیورپول', logo: 'liverpool.png' }
              }
            ]
          }
        ]
      }
    ]
  };
}

function livescoreRoot(id = 101) {
  return [
    {
      dates: [
        {
          date: '1405/05/30',
          matches: [
            {
              id,
              time: '22:30',
              status: 2,
              statusTitle: 'نیمه اول',
              isLive: true,
              liveTime: '23',
              host: {
                id: 87,
                name: 'آرسنال',
                logo: 'live-arsenal.png',
                goals: 0
              },
              guest: {
                id: 90,
                name: 'لیورپول',
                logo: 'live-liverpool.png',
                goals: 1
              }
            }
          ]
        }
      ]
    }
  ];
}

function providerFetch(liveRoot = livescoreRoot()) {
  return async (url) =>
    url.includes('/livescore/today')
      ? response(liveRoot)
      : response(seasonPage());
}

test('live endpoint IDs match existing matches endpoint IDs and index is reused', async () => {
  let seasonFetches = 0;
  globalThis.fetch = async (url) => {
    if (url.includes('/livescore/today')) {
      return response(livescoreRoot());
    }
    seasonFetches += 1;
    return response(seasonPage());
  };

  const season = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/matches')
    .expect(200);
  const matchId = season.body.matches[0].id;
  const live = await request(app).get(`/matches/${matchId}/live`).expect(200);

  assert.equal(seasonFetches, 1);
  assert.equal(live.body.match.id, matchId);
  assert.equal(
    live.body.match.home_team_id,
    season.body.matches[0].home_team_id
  );
  assert.equal(
    live.body.match.away_team_id,
    season.body.matches[0].away_team_id
  );
  assert.equal(live.body.match.status, 'live');
  assert.equal(live.body.match.live_phase, 'first_half');
  assert.equal(live.body.match.minute, 23);
  assert.equal(live.body.match.home_score, 0);
  const serialized = JSON.stringify(live.body);
  assert.equal(serialized.includes('provider_league_id'), false);
  assert.equal(serialized.includes('provider_season_id'), false);
});

test('raw numeric and malformed match IDs return the safe 404 response', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response({});
  };

  for (const matchId of ['101', 'mp_match_bad']) {
    const result = await request(app)
      .get(`/matches/${matchId}/live`)
      .expect(404);
    assert.deepEqual(result.body, { ok: false, error: 'Match not found' });
  }
  assert.equal(calls, 0);
});

test('unknown stable match ID returns 404 after a successful season refresh', async () => {
  globalThis.fetch = providerFetch();
  const unknownId = stableId('match', 'varzesh3', 999);

  const result = await request(app)
    .get(`/matches/${unknownId}/live`)
    .expect(404);
  assert.deepEqual(result.body, { ok: false, error: 'Match not found' });
});

test('provider failure while building the match index returns a safe 502', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('private provider detail');
  };
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/live`)
    .expect(502);
  assert.deepEqual(result.body, { ok: false, error: 'Provider unavailable' });
});

test('absent today live record returns a non-stale season snapshot warning', async () => {
  globalThis.fetch = providerFetch(livescoreRoot(999));
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/live`)
    .expect(200);

  assert.equal(result.body.match.status, 'upcoming');
  assert.equal(result.body.match.stale, false);
  assert.ok(
    result.body.match.warnings.includes(
      'live_record_not_found_using_season_snapshot'
    )
  );
});

test('livescore provider failure returns a stale resolved season snapshot', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('/livescore/today')) {
      throw new TypeError('private live provider detail');
    }
    return response(seasonPage());
  };
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/live`)
    .expect(200);

  assert.equal(result.body.match.stale, true);
  assert.ok(
    result.body.match.warnings.includes(
      'live_provider_unavailable_using_season_snapshot'
    )
  );
  assert.equal(JSON.stringify(result.body).includes('private'), false);
});

test('live records match only by normalized external match ID', () => {
  const wrongIdSameTeams = {
    id: 999,
    host: { name: 'آرسنال' },
    guest: { name: 'لیورپول' }
  };
  assert.equal(matchesExternalId(wrongIdSameTeams, 101), false);
  assert.equal(matchesExternalId({ id: ' 101 ' }, 101), true);
});

test('unexpected live-service programming errors use the central 500 response', async () => {
  globalThis.fetch = async () => response(seasonPage());
  const matchId = stableId('match', 'varzesh3', 101);
  await request(app)
    .get('/competitions/premier_league/seasons/2026-2027/matches')
    .expect(200);
  varzesh3.getTodayLivescore = async () => {
    throw new Error('private implementation detail');
  };

  const result = await request(app)
    .get(`/matches/${matchId}/live`)
    .expect(500);
  assert.deepEqual(result.body, {
    ok: false,
    error: 'Internal server error'
  });
});
