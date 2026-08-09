'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const varzesh3 = require('../src/providers/varzesh3');
const competitionDataService = require('../src/services/competitionDataService');

const originalMatches = varzesh3.fetchSeasonMatches;
const originalStandings = varzesh3.fetchSeasonStandings;

function providerMatches() {
  return {
    matches: [
      {
        round: 1,
        date: { date: '1405/05/30' },
        match: {
          id: 101,
          status: 1,
          host: { id: 87, name: 'Arsenal' },
          guest: { id: 90, name: 'Liverpool' }
        }
      }
    ],
    pagesFetched: 1,
    pageLimitReached: false
  };
}

function providerStandings() {
  return {
    teams: [
      { rank: 1, id: 87, name: 'Arsenal' },
      { rank: 2, id: 90, name: 'Liverpool' }
    ]
  };
}

test.beforeEach(() => {
  varzesh3.clearSeasonDataCache();
});

test.afterEach(() => {
  varzesh3.fetchSeasonMatches = originalMatches;
  varzesh3.fetchSeasonStandings = originalStandings;
  varzesh3.clearSeasonDataCache();
});

test('getMatches and getTeams coalesce the underlying season matches request', async () => {
  let matchCalls = 0;
  let standingCalls = 0;
  varzesh3.fetchSeasonMatches = async () => {
    matchCalls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return providerMatches();
  };
  varzesh3.fetchSeasonStandings = async () => {
    standingCalls += 1;
    return providerStandings();
  };

  const [matches, teams] = await Promise.all([
    competitionDataService.getMatches('premier_league', '2026-2027'),
    competitionDataService.getTeams('premier_league', '2026-2027')
  ]);

  assert.equal(matchCalls, 1);
  assert.equal(standingCalls, 1);
  assert.equal(matches.matches.length, 1);
  assert.equal(teams.teams.length, 2);
  assert.equal(matches.matches[0].home_team_id, teams.teams[0].id);
});

test('getStandings and getTeams coalesce the underlying standings request', async () => {
  let matchCalls = 0;
  let standingCalls = 0;
  varzesh3.fetchSeasonMatches = async () => {
    matchCalls += 1;
    return providerMatches();
  };
  varzesh3.fetchSeasonStandings = async () => {
    standingCalls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return providerStandings();
  };

  const [standings, teams] = await Promise.all([
    competitionDataService.getStandings('premier_league', '2026-2027'),
    competitionDataService.getTeams('premier_league', '2026-2027')
  ]);

  assert.equal(standingCalls, 1);
  assert.equal(matchCalls, 1);
  assert.equal(standings.length, 2);
  assert.equal(teams.teams.length, 2);
  assert.equal(standings[0].team_id, teams.teams[0].id);
});

test('ten concurrent matches endpoint requests use one provider season fetch', async () => {
  let matchCalls = 0;
  varzesh3.fetchSeasonMatches = async () => {
    matchCalls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    return providerMatches();
  };
  varzesh3.fetchSeasonStandings = async () => {
    throw new Error('standings should not be required');
  };

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app).get(
        '/competitions/premier_league/seasons/2026-2027/matches'
      )
    )
  );

  assert.equal(matchCalls, 1);
  assert.equal(responses.every((response) => response.status === 200), true);
  assert.equal(responses.every((response) => response.body.count === 1), true);
});
