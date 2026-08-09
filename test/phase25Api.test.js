'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const stableId = require('../src/utils/stableId');
const varzesh3 = require('../src/providers/varzesh3');
const matchLocatorService = require('../src/services/matchLocatorService');

const originalFetch = globalThis.fetch;
const originalGetMatchEvents = varzesh3.getMatchEvents;

test.beforeEach(() => {
  matchLocatorService.clearMatchIndex();
  varzesh3.clearSeasonDataCache();
  varzesh3.clearEventCache();
  varzesh3.clearLivescoreCache();
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  varzesh3.getMatchEvents = originalGetMatchEvents;
  matchLocatorService.clearMatchIndex();
  varzesh3.clearSeasonDataCache();
  varzesh3.clearEventCache();
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
            matches: [
              {
                id: 101,
                time: '22:30',
                status: 1,
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

function rawEvents() {
  return [
    {
      id: 501,
      eventType: 1,
      goalType: 0,
      side: 0,
      time: '23',
      strickerName: 'بازیکن گلزن',
      matchResult: { host: 1, guest: 0 }
    }
  ];
}

test('stable match resolves before event request and returns normalized public events', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return url.includes('/events') ? response(rawEvents()) : response(seasonPage());
  };
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/events`)
    .expect(200);

  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/seasons\/902037\/matches$/);
  assert.match(calls[1], /\/matches\/101\/events$/);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.match_id, matchId);
  assert.equal(result.body.external_match_id, 101);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.events[0].normalized_type, 'goal');
  assert.equal(result.body.events[0].team_id, stableId('team', 'varzesh3', 87));
  assert.equal(result.body.stale, false);
  assert.deepEqual(result.body.warnings, []);
  const serialized = JSON.stringify(result.body);
  assert.equal(serialized.includes('provider_league_id'), false);
  assert.equal(serialized.includes('provider_season_id'), false);
  assert.equal(serialized.includes('/livescore/football'), false);
});

test('raw numeric and malformed stable IDs return 404 without event requests', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response([]);
  };

  for (const id of ['101', 'mp_match_bad']) {
    const result = await request(app).get(`/matches/${id}/events`).expect(404);
    assert.deepEqual(result.body, { ok: false, error: 'Match not found' });
  }
  assert.equal(calls, 0);
});

test('provider failure during index refresh returns 502 before event retrieval', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError('private season failure');
  };
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/events`)
    .expect(502);
  assert.deepEqual(result.body, { ok: false, error: 'Provider unavailable' });
  assert.equal(calls, 1);
});

test('structurally valid empty events return a non-stale empty success', async () => {
  globalThis.fetch = async (url) =>
    url.includes('/events') ? response([]) : response(seasonPage());
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/events`)
    .expect(200);
  assert.equal(result.body.count, 0);
  assert.deepEqual(result.body.events, []);
  assert.equal(result.body.stale, false);
  assert.deepEqual(result.body.warnings, []);
});

test('event provider 404 returns events-not-available instead of match 404', async () => {
  globalThis.fetch = async (url) =>
    url.includes('/events') ? response({}, 404) : response(seasonPage());
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/events`)
    .expect(200);
  assert.equal(result.body.count, 0);
  assert.equal(result.body.stale, false);
  assert.deepEqual(result.body.warnings, ['events_not_available']);
});

test('event provider failure without cache returns a safe 502', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('/events')) {
      throw new TypeError('private event failure');
    }
    return response(seasonPage());
  };
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/events`)
    .expect(502);
  assert.deepEqual(result.body, { ok: false, error: 'Provider unavailable' });
  assert.equal(JSON.stringify(result.body).includes('private'), false);
});

test('provider failure with cached events returns a stale 200 response', async () => {
  globalThis.fetch = async () => response(seasonPage());
  varzesh3.getMatchEvents = async () => ({
    events: rawEvents(),
    stale: true
  });
  const matchId = stableId('match', 'varzesh3', 101);

  const result = await request(app)
    .get(`/matches/${matchId}/events`)
    .expect(200);
  assert.equal(result.body.count, 1);
  assert.equal(result.body.stale, true);
  assert.deepEqual(result.body.warnings, [
    'events_provider_unavailable_using_cache'
  ]);
});

test('existing live endpoint behavior remains unchanged after events support', async () => {
  globalThis.fetch = async (url) => {
    if (url.includes('/events') || url.includes('/livescore/today')) {
      return response([]);
    }
    return response(seasonPage());
  };
  const matchId = stableId('match', 'varzesh3', 101);

  await request(app).get(`/matches/${matchId}/events`).expect(200);
  const live = await request(app).get(`/matches/${matchId}/live`).expect(200);
  assert.equal(live.body.match.id, matchId);
  assert.equal(live.body.match.stale, false);
  assert.ok(
    live.body.match.warnings.includes(
      'live_record_not_found_using_season_snapshot'
    )
  );
});
