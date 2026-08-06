'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const stableId = require('../src/utils/stableId');
const {
  normalizeEvent,
  normalizeEvents,
  normalizeEventType
} = require('../src/providers/varzesh3/normalizers');

function snapshot() {
  return {
    id: stableId('match', 'varzesh3', 101),
    competition_key: 'premier_league',
    season_key: '2026-2027',
    provider: 'varzesh3',
    external_match_id: 101,
    home_external_team_id: 87,
    away_external_team_id: 90,
    home_team_id: stableId('team', 'varzesh3', 87),
    away_team_id: stableId('team', 'varzesh3', 90)
  };
}

test('confirmed top-level Varzesh3 event types normalize conservatively', () => {
  const expected = new Map([
    [1, 'goal'],
    [2, 'yellow_card'],
    [3, 'other'],
    [4, 'substitution'],
    [5, 'var'],
    [6, 'var'],
    [7, 'own_goal'],
    [8, 'red_card'],
    [9, 'missed_penalty'],
    [10, 'other'],
    [11, 'halftime'],
    [12, 'fulltime']
  ]);
  for (const [eventType, normalizedType] of expected) {
    assert.equal(normalizeEventType({ eventType }), normalizedType);
  }
  assert.equal(normalizeEventType({ eventType: 999 }), 'other');
  assert.equal(normalizeEventType({ type: 'VAR' }), 'var');
  assert.equal(normalizeEventType({ type: 'kickoff' }), 'kickoff');
  assert.equal(normalizeEventType({ type: 'halftime' }), 'halftime');
  assert.equal(normalizeEventType({ type: 'fulltime' }), 'fulltime');
});

test('confirmed card types preserve red cards and require explicit second-yellow evidence', () => {
  assert.equal(normalizeEventType({ eventType: 2, cardType: 1 }), 'yellow_card');
  assert.equal(normalizeEventType({ eventType: 2, cardType: 2 }), 'red_card');
  assert.equal(normalizeEventType({ eventType: 2, cardType: 3 }), 'red_card');
  assert.notEqual(
    normalizeEventType({ eventType: 2, cardType: 3 }),
    'second_yellow_red'
  );
  assert.equal(
    normalizeEventType({ eventType: 2, description: 'second yellow card' }),
    'second_yellow_red'
  );
  assert.equal(
    normalizeEventType({ eventType: 2, cardTypeTitle: 'دومین کارت زرد' }),
    'second_yellow_red'
  );
  assert.equal(
    normalizeEventType({ eventType: 2, cardType: 'second yellow' }),
    'second_yellow_red'
  );
});

test('penalty events require explicit scored or missed evidence', () => {
  assert.equal(normalizeEventType({ eventType: 3 }), 'other');
  assert.equal(normalizeEventType({ eventType: 3, penaltyResult: 1 }), 'other');
  assert.equal(normalizeEventType({ eventType: 3, penaltyResult: 2 }), 'other');
  assert.equal(
    normalizeEventType({ eventType: 3, penaltyResult: 3 }),
    'missed_penalty'
  );
  assert.equal(
    normalizeEventType({ eventType: 3, isScored: true }),
    'penalty_goal'
  );
  assert.equal(
    normalizeEventType({ eventType: 3, isSuccessful: '1' }),
    'penalty_goal'
  );
  assert.equal(
    normalizeEventType({ eventType: 3, outcome: 'converted' }),
    'penalty_goal'
  );
  assert.equal(
    normalizeEventType({ eventType: 3, description: 'penalty scored' }),
    'penalty_goal'
  );
  assert.equal(
    normalizeEventType({ eventType: 3, penaltyResultTitle: 'saved' }),
    'missed_penalty'
  );
  assert.equal(
    normalizeEventType({ eventType: 3, description: 'penalty not scored' }),
    'missed_penalty'
  );
});

test('proven Persian missed-penalty terms remain missed and non-scoring', () => {
  for (const description of [
    'پنالتی مهار شده',
    'پنالتی را مهار کرد',
    'پنالتی خراب شد',
    'پنالتی ناموفق'
  ]) {
    const event = normalizeEvent(
      { eventType: 3, description, side: 0 },
      snapshot(),
      0
    );
    assert.equal(event.normalized_type, 'missed_penalty');
    assert.equal(event.is_scoring_event, false);
  }
});

test('numeric goalType values do not determine goal semantics', () => {
  assert.equal(normalizeEventType({ eventType: 1, goalType: 1 }), 'goal');
  assert.equal(normalizeEventType({ eventType: 1, goalType: 2 }), 'goal');
  assert.equal(
    normalizeEventType({ eventType: 1, goalType: 'own goal' }),
    'own_goal'
  );
});

test('shootout and disallowed-goal events never become regulation scoring events', () => {
  for (const shootoutSignal of [
    { scope: 6 },
    { isPenaltyShootout: true },
    { isShootout: true },
    { phase: 'penalty_shootout' },
    { description: 'Penalty shootout' }
  ]) {
    const event = normalizeEvent(
      { eventType: 3, penaltyResult: 1, isGoal: true, ...shootoutSignal },
      snapshot(),
      0
    );
    assert.equal(event.normalized_type, 'other');
    assert.equal(event.is_scoring_event, false);
  }

  const disallowed = normalizeEvent(
    { eventType: 5, description: 'goal disallowed', side: 0 },
    snapshot(),
    0
  );
  assert.equal(disallowed.normalized_type, 'var');
  assert.equal(disallowed.is_scoring_event, false);
});

test('stable event IDs include match and provider event identity', () => {
  const first = normalizeEvent({ id: 55, eventType: 1 }, snapshot(), 0);
  const second = normalizeEvent({ id: 55, eventType: 1 }, snapshot(), 9);

  assert.equal(first.id, second.id);
  assert.equal(
    first.id,
    stableId('event', 'varzesh3', '101:55')
  );
  assert.equal(first.external_event_id, 55);
});

test('ID-less events keep null canonical and external IDs', () => {
  const event = normalizeEvent({ eventType: 1 }, snapshot(), 0);
  assert.equal(event.id, null);
  assert.equal(event.external_event_id, null);
});

test('score zero, minute, added time, and Persian names are preserved', () => {
  const normal = normalizeEvent(
    {
      id: 1,
      eventType: 1,
      time: '23',
      side: 0,
      strickerName: '  بازیکن گلزن  ',
      assisterName: '  پاسور  ',
      matchResult: { host: 0, guest: 1 }
    },
    snapshot(),
    0
  );
  const added = normalizeEvent(
    { id: 2, eventType: 1, time: '45+2', side: 1 },
    snapshot(),
    1
  );

  assert.equal(normal.home_score, 0);
  assert.equal(normal.away_score, 1);
  assert.equal(normal.minute, 23);
  assert.equal(normal.raw_minute, '23');
  assert.equal(normal.player_name_fa, 'بازیکن گلزن');
  assert.equal(normal.secondary_player_name_fa, 'پاسور');
  assert.equal(normal.player_name_en, null);
  assert.equal(normal.secondary_player_name_en, null);
  assert.equal(added.minute, 45);
  assert.equal(added.raw_minute, '45+2');
});

test('all provider minute aliases preserve normal, added, and descriptive values', () => {
  const cases = [
    ['time', 23, 23, 23],
    ['rawTime', '23', 23, '23'],
    ['minute', '45+2', 45, '45+2'],
    ['eventTime', '90+5', 90, '90+5'],
    ['eventTime', 'half-time', null, 'half-time']
  ];
  for (const [field, value, minute, rawMinute] of cases) {
    const event = normalizeEvent(
      { eventType: 11, [field]: value },
      snapshot(),
      0
    );
    assert.equal(event.minute, minute);
    assert.equal(event.raw_minute, rawMinute);
  }
  const missing = normalizeEvent({ eventType: 11 }, snapshot(), 0);
  assert.equal(missing.minute, null);
  assert.equal(missing.raw_minute, null);
});

test('explicit home and away sides reuse canonical season team IDs', () => {
  const home = normalizeEvent({ eventType: 1, side: 0 }, snapshot(), 0);
  const away = normalizeEvent({ eventType: 1, side: 'away' }, snapshot(), 1);
  const awayOwnGoal = normalizeEvent(
    { eventType: 7, side: 1 },
    snapshot(),
    2
  );

  assert.equal(home.team_side, 'home');
  assert.equal(home.team_id, snapshot().home_team_id);
  assert.equal(away.team_side, 'away');
  assert.equal(away.team_id, snapshot().away_team_id);
  assert.equal(awayOwnGoal.normalized_type, 'own_goal');
  assert.equal(awayOwnGoal.team_side, 'away');
  assert.equal(awayOwnGoal.team_id, snapshot().away_team_id);
  assert.equal(awayOwnGoal.is_scoring_event, true);
});

test('provider team ID and explicit team link resolve event side', () => {
  const byId = normalizeEvent({ eventType: 2, teamId: 90 }, snapshot(), 0);
  const byLink = normalizeEvent(
    { eventType: 2, teamLink: '/football/team/87/arsenal' },
    snapshot(),
    1
  );

  assert.equal(byId.team_side, 'away');
  assert.equal(byId.team_id, snapshot().away_team_id);
  assert.equal(byLink.team_side, 'home');
  assert.equal(byLink.team_id, snapshot().home_team_id);
});

test('unresolved team-specific events receive an explicit warning', () => {
  const event = normalizeEvent(
    { eventType: 1, strickerName: 'بازیکن' },
    snapshot(),
    0
  );

  assert.equal(event.team_side, null);
  assert.equal(event.team_id, null);
  assert.ok(event.warnings.includes('event_team_unresolved'));
});

test('substitution maps only explicit incoming and outgoing player fields', () => {
  const event = normalizeEvent(
    {
      eventType: 4,
      side: 0,
      incomingPlayerName: 'بازیکن ورودی',
      outgoingPlayerName: 'بازیکن خروجی'
    },
    snapshot(),
    0
  );

  assert.equal(event.normalized_type, 'substitution');
  assert.equal(event.player_name_fa, null);
  assert.equal(event.player_in_name_fa, 'بازیکن ورودی');
  assert.equal(event.player_out_name_fa, 'بازیکن خروجی');
  assert.equal(event.player_in_name_en, null);
  assert.equal(event.player_out_name_en, null);
  assert.equal(event.is_scoring_event, false);
});

test('only goal, own-goal, and penalty-goal events are scoring', () => {
  for (const type of ['goal', 'own goal', 'penalty goal']) {
    assert.equal(
      normalizeEvent({ type, side: 0 }, snapshot(), 0).is_scoring_event,
      true
    );
  }
  for (const type of ['missed penalty', 'yellow card', 'red card', 'substitution']) {
    assert.equal(
      normalizeEvent({ type, side: 0 }, snapshot(), 0).is_scoring_event,
      false
    );
  }
  assert.equal(
    normalizeEvent({ eventType: 3, side: 0 }, snapshot(), 0).is_scoring_event,
    false
  );
  assert.equal(
    normalizeEvent({ eventType: 5, side: 0 }, snapshot(), 0).is_scoring_event,
    false
  );
  assert.equal(
    normalizeEvent({ eventType: 9, side: 0 }, snapshot(), 0).is_scoring_event,
    false
  );
});

test('events sort by minute, explicit sequence, then provider payload order', () => {
  const events = normalizeEvents(
    [
      { id: 1, eventType: 1, time: '45', sequence: 2, side: 0 },
      { id: 2, eventType: 1, time: '10', side: 0 },
      { id: 3, eventType: 1, time: '45', sequence: 1, side: 0 },
      { id: 4, eventType: 1, time: '45', sequence: 1, side: 1 }
    ],
    snapshot()
  );

  assert.deepEqual(
    events.map((event) => event.external_event_id),
    [2, 3, 4, 1]
  );
  assert.equal('_originalIndex' in events[0], false);
});
