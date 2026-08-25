'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const app = require('../src/app');
const varzesh3 = require('../src/providers/varzesh3');

function assertNoProviderIds(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes('provider_league_id'), false);
  assert.equal(serialized.includes('provider_season_id'), false);
}

test('GET /health returns service health', async () => {
  const response = await request(app).get('/health').expect(200);

  assert.deepEqual(response.body, {
    ok: true,
    service: 'generic-football-wrapper',
    version: '0.1.0'
  });
});

test('GET /competitions returns all configured competitions without provider IDs', async () => {
  const response = await request(app).get('/competitions').expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.count, 8);
  assert.equal(response.body.competitions[0].name_en, 'Premier League');
  assertNoProviderIds(response.body);
});

test('GET /competitions/:competitionKey returns competition detail', async () => {
  const response = await request(app)
    .get('/competitions/premier_league')
    .expect(200);

  assert.equal(response.body.competition_key, 'premier_league');
  assertNoProviderIds(response.body);
});

test('competition keys are normalized', async () => {
  const response = await request(app)
    .get('/competitions/%20PREMIER_LEAGUE%20')
    .expect(200);

  assert.equal(response.body.competition_key, 'premier_league');
});

test('unknown competition returns required 404 response', async () => {
  const response = await request(app)
    .get('/competitions/not_a_competition')
    .expect(404);

  assert.deepEqual(response.body, {
    ok: false,
    error: 'Competition not found'
  });
});

test('season list returns 2026-2027 without provider IDs', async () => {
  const response = await request(app)
    .get('/competitions/premier_league/seasons')
    .expect(200);

  assert.equal(response.body.ok, true);
  assert.equal(response.body.competition_key, 'premier_league');
  assert.equal(response.body.count, 1);
  assert.equal(response.body.seasons[0].season_key, '2026-2027');
  assertNoProviderIds(response.body);
});

test('season detail returns 200 without provider IDs', async () => {
  const response = await request(app)
    .get('/competitions/premier_league/seasons/2026-2027')
    .expect(200);

  assert.equal(response.body.season_key, '2026-2027');
  assertNoProviderIds(response.body);
});

test('unknown season returns required 404 response', async () => {
  const response = await request(app)
    .get('/competitions/premier_league/seasons/unknown')
    .expect(404);

  assert.deepEqual(response.body, { ok: false, error: 'Season not found' });
});

test('unknown route returns required 404 response', async () => {
  const response = await request(app).get('/not-a-route').expect(404);

  assert.deepEqual(response.body, { ok: false, error: 'Route not found' });
});

test('Varzesh3 adapter returns internal mappings and null for unknown keys', () => {
  assert.equal(varzesh3.providerKey, 'varzesh3');
  assert.equal(
    varzesh3.getCompetitionMapping('premier_league').provider_league_id,
    3
  );
  assert.equal(
    varzesh3.getSeasonMapping('premier_league', '2026-2027')
      .provider_season_id,
    902037
  );
  assert.equal(varzesh3.getCompetitionMapping('unknown'), null);
  assert.equal(varzesh3.getSeasonMapping('premier_league', 'unknown'), null);
});

test('services return copies that cannot mutate registry state', () => {
  const competitionService = require('../src/services/competitionService');
  const seasonService = require('../src/services/seasonService');

  const competition = competitionService.getCompetition('premier_league');
  competition.capabilities.supports_matches = false;
  assert.equal(
    competitionService.getCompetition('premier_league').capabilities
      .supports_matches,
    true
  );

  const season = seasonService.getSeason('premier_league', '2026-2027');
  season.capabilities.supports_matches = false;
  assert.equal(
    seasonService.getSeason('premier_league', '2026-2027').capabilities
      .supports_matches,
    true
  );
});
