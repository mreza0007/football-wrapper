'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const varzesh3 = require('../src/providers/varzesh3');

const expectedScopes = [
  ['premier_league', '2026-2027', 3, 902037, true],
  ['persian_gulf_pro_league', '1405-1406', 6, 903038, true],
  ['la_liga', '2026-2027', 2, 902054, true],
  ['serie_a', '2026-2027', 4, 902038, true],
  ['bundesliga', '2026-2027', 1, 902055, true],
  ['ligue_1', '2026-2027', 5, 902039, true],
  ['champions_league', '2026-2027', 25, 902063, false],
  ['europa_league', '2026-2027', 29, 902064, false]
];

test('competition directory exposes all required active scopes', async () => {
  const response = await request(app).get('/competitions').expect(200);
  const competitions = new Map(
    response.body.competitions.map((competition) => [competition.competition_key, competition])
  );
  assert.equal(response.body.count, expectedScopes.length);
  for (const [competitionKey, seasonKey, , , supportsStandings] of expectedScopes) {
    const competition = competitions.get(competitionKey);
    assert.ok(competition, `missing ${competitionKey}`);
    assert.equal(competition.default_season_key, seasonKey);
    assert.equal(competition.status, 'active');
    assert.equal(competition.is_active, true);
    assert.equal(competition.capabilities.supports_matches, true);
    assert.equal(competition.capabilities.supports_teams, true);
    assert.equal(competition.capabilities.supports_standings, supportsStandings);
  }
});

test('required scopes use the verified Varzesh3 mappings', () => {
  for (const [competitionKey, seasonKey, leagueId, seasonId] of expectedScopes) {
    assert.equal(varzesh3.getCompetitionMapping(competitionKey).provider_league_id, leagueId);
    assert.equal(varzesh3.getSeasonMapping(competitionKey, seasonKey).provider_season_id, seasonId);
  }
});

test('each required competition exposes its configured default season', async () => {
  for (const [competitionKey, seasonKey] of expectedScopes) {
    const response = await request(app)
      .get(`/competitions/${competitionKey}/seasons`)
      .expect(200);
    assert.equal(response.body.count, 1);
    assert.equal(response.body.seasons[0].season_key, seasonKey);
    assert.equal(response.body.seasons[0].is_default, true);
  }
});

test('tournament standings capability is rejected without a provider request', async () => {
  const original = varzesh3.getSeasonStandings;
  let providerCalled = false;
  varzesh3.getSeasonStandings = async () => {
    providerCalled = true;
    return { teams: [] };
  };
  try {
    const response = await request(app)
      .get('/competitions/champions_league/seasons/2026-2027/standings')
      .expect(501);
    assert.deepEqual(response.body, { ok: false, error: 'Standings not supported' });
    assert.equal(providerCalled, false);
  } finally {
    varzesh3.getSeasonStandings = original;
  }
});
