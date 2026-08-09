'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const varzesh3 = require('../src/providers/varzesh3');
const competitionDataService = require('../src/services/competitionDataService');

test.beforeEach(() => {
  varzesh3.clearSeasonDataCache();
});

test.afterEach(() => {
  varzesh3.clearSeasonDataCache();
});

test('teams service preserves provider page-limit warning without duplication', async () => {
  const originalStandings = varzesh3.fetchSeasonStandings;
  const originalMatches = varzesh3.fetchSeasonMatches;
  varzesh3.fetchSeasonStandings = async () => ({
    teams: [{ rank: 1, id: 87, name: 'آرسنال' }]
  });
  varzesh3.fetchSeasonMatches = async () => ({
    matches: [],
    pageLimitReached: true
  });

  try {
    const result = await competitionDataService.getTeams(
      'premier_league',
      '2026-2027'
    );
    assert.deepEqual(result.warnings, ['provider_page_limit_reached']);
  } finally {
    varzesh3.fetchSeasonStandings = originalStandings;
    varzesh3.fetchSeasonMatches = originalMatches;
  }
});

test('teams service falls back to matches when standings teams are empty', async () => {
  const originalStandings = varzesh3.fetchSeasonStandings;
  const originalMatches = varzesh3.fetchSeasonMatches;
  varzesh3.fetchSeasonStandings = async () => ({ teams: [] });
  varzesh3.fetchSeasonMatches = async () => ({
    matches: [
      {
        round: 1,
        date: { date: '1405/05/30' },
        match: {
          id: 101,
          status: 1,
          host: { id: 87, name: 'آرسنال' },
          guest: { id: 90, name: 'لیورپول' }
        }
      }
    ],
    pageLimitReached: false
  });

  try {
    const result = await competitionDataService.getTeams(
      'premier_league',
      '2026-2027'
    );
    assert.equal(result.teams.length, 2);
    assert.deepEqual(result.warnings, [
      'standings_unavailable_teams_derived_from_matches'
    ]);
  } finally {
    varzesh3.fetchSeasonStandings = originalStandings;
    varzesh3.fetchSeasonMatches = originalMatches;
  }
});
