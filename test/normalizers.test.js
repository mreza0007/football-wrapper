'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMatch,
  normalizeMatches,
  normalizeStandings,
  normalizeTeams,
  normalizeStatus,
  scoreValue,
  teamIdFromLink,
  validKickoffUtc
} = require('../src/providers/varzesh3/normalizers');

function entry(overrides = {}) {
  return {
    round: 4,
    date: { date: '۱۴۰۵/۰۵/۱۰', utcTime: '0001-01-01T00:00:00' },
    match: {
      id: 100,
      time: '18:30',
      status: 1,
      isLive: false,
      host: { id: 87, name: 'آرسنال', logo: 'home.png' },
      guest: { id: 90, name: 'لیورپول', logo: 'away.png' },
      ...overrides
    }
  };
}

function emptyMaps() {
  return { matchTeams: new Map(), standingTeams: new Map() };
}

test('raw match statuses and isLive are normalized', () => {
  assert.equal(normalizeStatus({ status: 1 }), 'upcoming');
  for (const status of [2, 3, 4, 5, 6]) {
    assert.equal(normalizeStatus({ status }), 'live');
  }
  assert.equal(normalizeStatus({ status: 7 }), 'finished');
  assert.equal(normalizeStatus({ status: 99, isLive: true }), 'live');
  assert.equal(normalizeStatus({ status: 99, statusTitle: 'وقت اضافه' }), 'live');
  assert.equal(
    normalizeStatus({ status: 99, statusTitle: 'ضربات پنالتی' }),
    'live'
  );
  assert.equal(normalizeStatus({ status: 99, statusTitle: 'پایان بازی' }), 'finished');
  assert.equal(normalizeStatus({ status: 99 }), null);
});

test('numeric score zero is preserved and missing scores are null', () => {
  assert.equal(scoreValue({ goals: { host: 0 } }, 'home'), 0);
  assert.equal(scoreValue({}, 'home'), null);
});

test('UTC sentinel is rejected while genuine UTC is normalized', () => {
  assert.equal(validKickoffUtc('0001-01-01T00:00:00'), null);
  assert.equal(validKickoffUtc('2026-08-10T18:30:00Z'), '2026-08-10T18:30:00.000Z');
  assert.equal(validKickoffUtc('2026-08-10T18:30:00'), null);
});

test('team identity is parsed from a provider team link', () => {
  assert.equal(teamIdFromLink('/football/team/87/arsenal'), 87);
});

test('zero team ID is recovered from a link and is never canonical', () => {
  const raw = entry({
    host: { id: 0, name: 'آرسنال', link: '/football/team/87/arsenal' }
  });
  const match = normalizeMatch(raw, {
    competitionKey: 'premier_league',
    seasonKey: '2026-2027'
  }, emptyMaps());

  assert.equal(match.home_external_team_id, 87);
  assert.match(match.home_team_id, /^mp_team_/);
  assert.equal(match.home_team_id.includes('_0'), false);
});

test('unresolved team identity stays null and adds an explicit warning', () => {
  const raw = entry({ host: { id: 0, name: 'ناشناخته' } });
  const match = normalizeMatch(raw, {
    competitionKey: 'premier_league',
    seasonKey: '2026-2027'
  }, emptyMaps());

  assert.equal(match.home_team_id, null);
  assert.equal(match.home_external_team_id, null);
  assert.ok(match.warnings.includes('home_team_identity_unresolved'));
  assert.ok(match.warnings.includes('kickoff_utc_unresolved'));
});

test('identity is recovered from another match before standings', () => {
  const entries = [
    entry({ id: 1, host: { id: 87, name: 'آرسنال' } }),
    entry({ id: 2, host: { id: 0, name: 'آرسنال' } })
  ];
  const normalized = normalizeMatches(entries, {
    competitionKey: 'premier_league',
    seasonKey: '2026-2027'
  });

  assert.equal(normalized.matches[1].home_external_team_id, 87);
});

test('standing rows preserve zeros and use stable team IDs', () => {
  const standings = normalizeStandings({
    teams: [
      {
        rank: 1,
        id: 87,
        name: 'آرسنال',
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
  });

  assert.equal(standings[0].played, 0);
  assert.equal(standings[0].goals_for, 0);
  assert.equal(standings[0].external_team_id, 87);
  assert.match(standings[0].team_id, /^mp_team_/);
  assert.equal(standings[0].team_en, null);
});

test('zero standing team ID is never made canonical', () => {
  const standings = normalizeStandings({
    teams: [{ rank: 1, id: 0, name: 'ناشناخته' }]
  });

  assert.equal(standings[0].external_team_id, null);
  assert.equal(standings[0].team_id, null);
});

test('unknown-status matches are skipped with a count', () => {
  const result = normalizeMatches([entry({ status: 99 })], {
    competitionKey: 'premier_league',
    seasonKey: '2026-2027'
  });

  assert.equal(result.matches.length, 0);
  assert.equal(result.skippedUnknownStatus, 1);
});

test('teams merge duplicate resolved records with standings metadata preferred', () => {
  const result = normalizeTeams(
    {
      teams: [
        { rank: 1, id: 87, name: '  آرسنال  ', logo: 'standing.png' },
        { rank: 1, id: 87, name: 'نسخه تکراری', logo: 'duplicate.png' }
      ]
    },
    [entry({ host: { id: 87, name: 'نام مسابقه', logo: 'match.png' } })],
    { competitionKey: 'premier_league', seasonKey: '2026-2027' }
  );

  assert.equal(result.teams.length, 1);
  assert.equal(result.teams[0].name_fa, 'آرسنال');
  assert.equal(result.teams[0].logo, 'standing.png');
  assert.equal(result.teams[0].external_team_id, 87);
  assert.equal('rank' in result.teams[0], false);
});

test('missing standings metadata is filled from match records', () => {
  const result = normalizeTeams(
    { teams: [{ rank: 1, id: 87, name: null, logo: null }] },
    [entry({ host: { id: 87, name: ' آرسنال ', logo: 'match.png' } })],
    { competitionKey: 'premier_league', seasonKey: '2026-2027' }
  );

  assert.equal(result.teams[0].name_fa, 'آرسنال');
  assert.equal(result.teams[0].logo, 'match.png');
});

test('team ID zero is recovered from a link in normalized teams', () => {
  const result = normalizeTeams(
    null,
    [
      entry({
        host: {
          id: 0,
          name: 'آرسنال',
          link: '/football/team/87/arsenal'
        }
      })
    ],
    { competitionKey: 'premier_league', seasonKey: '2026-2027' }
  );

  const arsenal = result.teams.find((team) => team.name_fa === 'آرسنال');
  assert.equal(arsenal.external_team_id, 87);
  assert.match(arsenal.id, /^mp_team_/);
  assert.deepEqual(arsenal.warnings, []);
});

test('unresolved normalized teams keep null IDs and deduplicate exact payload duplicates', () => {
  const unresolved = { id: 0, name: ' ناشناخته ', logo: 'same.png' };
  const result = normalizeTeams(
    null,
    [entry({ host: unresolved, guest: { ...unresolved } })],
    { competitionKey: 'premier_league', seasonKey: '2026-2027' }
  );

  assert.equal(result.teams.length, 1);
  assert.equal(result.teams[0].id, null);
  assert.equal(result.teams[0].external_team_id, null);
  assert.deepEqual(result.teams[0].warnings, ['team_identity_unresolved']);
  assert.equal(result.unresolvedTeamIdentities, 1);
});

test('match-derived teams sort deterministically by Persian name then ID', () => {
  const result = normalizeTeams(
    null,
    [
      entry({
        host: { id: 90, name: 'لیورپول' },
        guest: { id: 87, name: 'آرسنال' }
      })
    ],
    { competitionKey: 'premier_league', seasonKey: '2026-2027' }
  );

  assert.deepEqual(
    result.teams.map((team) => team.external_team_id),
    [87, 90]
  );
});

test('empty standings derive normalized teams from valid match entries', () => {
  const result = normalizeTeams(
    { teams: [] },
    [
      entry({
        host: { id: 87, name: 'آرسنال', logo: 'arsenal.png' },
        guest: { id: 90, name: 'لیورپول', logo: 'liverpool.png' }
      })
    ],
    { competitionKey: 'premier_league', seasonKey: '2026-2027' }
  );

  assert.deepEqual(
    result.teams.map((team) => team.external_team_id),
    [87, 90]
  );
  assert.ok(result.teams.every((team) => team.id.startsWith('mp_team_')));
});
