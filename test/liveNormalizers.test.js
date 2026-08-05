'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const stableId = require('../src/utils/stableId');
const {
  normalizeLiveMatch,
  normalizeLivePhase,
  normalizeMinute
} = require('../src/providers/varzesh3/normalizers');

function snapshot() {
  return {
    id: stableId('match', 'varzesh3', 101),
    competition_key: 'premier_league',
    season_key: '2026-2027',
    provider: 'varzesh3',
    external_match_id: 101,
    home_team_id: stableId('team', 'varzesh3', 87),
    away_team_id: stableId('team', 'varzesh3', 90),
    home_name_fa: 'آرسنال',
    away_name_fa: 'لیورپول',
    home_name_en: null,
    away_name_en: null,
    home_logo: 'arsenal.png',
    away_logo: 'liverpool.png',
    kickoff_utc: null,
    date_fa: '1405/05/30',
    time_iran: '22:30',
    round: 'هفته 1',
    status: 'upcoming',
    is_live: false,
    live_phase: null,
    home_score: 2,
    away_score: 3,
    home_penalties: null,
    away_penalties: null,
    warnings: ['kickoff_utc_unresolved']
  };
}

test('live scores override season scores and numeric zero is preserved', () => {
  const result = normalizeLiveMatch(snapshot(), {
    id: 101,
    status: 2,
    isLive: true,
    host: { goals: 0 },
    guest: { goals: 1 }
  });

  assert.equal(result.home_score, 0);
  assert.equal(result.away_score, 1);
  assert.equal(result.status, 'live');
  assert.equal(result.is_live, true);
});

test('missing live fields do not erase valid season metadata', () => {
  const result = normalizeLiveMatch(snapshot(), {
    id: 101,
    status: 99,
    host: { name: '', logo: null },
    guest: {}
  });

  assert.equal(result.home_name_fa, 'آرسنال');
  assert.equal(result.home_logo, 'arsenal.png');
  assert.equal(result.date_fa, '1405/05/30');
  assert.equal(result.round, 'هفته 1');
  assert.equal(result.status, 'upcoming');
});

test('missing liveTime does not imply a finished match', () => {
  const result = normalizeLiveMatch(snapshot(), {
    id: 101,
    status: 1,
    liveTime: ''
  });
  assert.equal(result.status, 'upcoming');
  assert.equal(result.minute, null);
});

test('explicit live phases normalize safely', () => {
  assert.equal(normalizeLivePhase('نیمه اول', null), 'first_half');
  assert.equal(normalizeLivePhase('پایان نیمه اول', null), 'halftime');
  assert.equal(normalizeLivePhase('نیمه دوم', null), 'second_half');
  assert.equal(normalizeLivePhase('ضربات پنالتی', null), 'penalties');
  assert.equal(normalizeLivePhase('', '23'), null);
});

test('minute parsing supports integers, strings, and added time', () => {
  assert.deepEqual(normalizeMinute(23), { minute: 23, rawMinute: 23 });
  assert.deepEqual(normalizeMinute('23'), { minute: 23, rawMinute: '23' });
  assert.deepEqual(normalizeMinute('45+2'), {
    minute: 45,
    rawMinute: '45+2'
  });
  assert.deepEqual(normalizeMinute('نیمه اول'), {
    minute: null,
    rawMinute: 'نیمه اول'
  });
});
