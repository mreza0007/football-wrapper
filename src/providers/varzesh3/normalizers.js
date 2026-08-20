'use strict';

const stableId = require('../../utils/stableId');

const PROVIDER_KEY = 'varzesh3';

function numericValue(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function externalTeamId(value) {
  const number = numericValue(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function teamIdFromLink(link) {
  if (typeof link !== 'string') {
    return null;
  }
  const match = link.match(/\/football\/team\/(\d+)(?:\/|$)/i);
  return match ? externalTeamId(match[1]) : null;
}

function directTeamIdentity(team) {
  return externalTeamId(team?.id) ?? teamIdFromLink(team?.link);
}

function identityName(name) {
  return typeof name === 'string' ? name.trim().toLocaleLowerCase('fa') : '';
}

function buildIdentityMaps(matchEntries, standing) {
  const matchTeams = new Map();
  const standingTeams = new Map();

  for (const entry of matchEntries) {
    for (const team of [entry.match?.host, entry.match?.guest]) {
      const name = identityName(team?.name);
      const id = directTeamIdentity(team);
      if (name && id && !matchTeams.has(name)) {
        matchTeams.set(name, id);
      }
    }
  }

  for (const team of Array.isArray(standing?.teams) ? standing.teams : []) {
    const name = identityName(team?.name);
    const id = directTeamIdentity(team);
    if (name && id && !standingTeams.has(name)) {
      standingTeams.set(name, id);
    }
  }

  return { matchTeams, standingTeams };
}

function resolveTeamIdentity(team, identityMaps) {
  const direct = externalTeamId(team?.id);
  if (direct) {
    return direct;
  }

  const linked = teamIdFromLink(team?.link);
  if (linked) {
    return linked;
  }

  const name = identityName(team?.name);
  return (
    identityMaps.matchTeams.get(name) ??
    identityMaps.standingTeams.get(name) ??
    null
  );
}

function normalizeStatus(match) {
  if (match?.isLive === true) {
    return 'live';
  }

  const rawStatus = numericValue(match?.status);
  if (rawStatus === 1) {
    return 'upcoming';
  }
  if ([2, 3, 4, 5, 6].includes(rawStatus)) {
    return 'live';
  }
  if (rawStatus === 7) {
    return 'finished';
  }

  const title = String(match?.statusTitle || '').trim().toLowerCase();
  if (
    /finished|full.?time|پایان بازی|پایان مسابقه|اتمام بازی|پایان ضربات پنالتی/.test(
      title
    )
  ) {
    return 'finished';
  }
  if (/live|زنده|در حال|نیمه|وقت اضافه|پنالتی|\bbreak\b|وقفه/.test(title)) {
    return 'live';
  }

  return null;
}

function validKickoffUtc(...values) {
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }
    const candidate = value.trim();
    if (/^0001-01-01/i.test(candidate)) {
      continue;
    }
    if (!/(?:z|[+-]\d{2}:?\d{2})$/i.test(candidate)) {
      continue;
    }
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp) && new Date(timestamp).getUTCFullYear() > 1900) {
      return new Date(timestamp).toISOString();
    }
  }
  return null;
}

function normalizePersianDigits(value) {
  return String(value ?? '')
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

function jalaliToGregorian(year, month, day) {
  let jy = year - 979;
  let jm = month - 1;
  let jd = day - 1;

  let jDayNo =
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4);

  for (let i = 0; i < jm; i += 1) {
    jDayNo += i < 6 ? 31 : 30;
  }
  jDayNo += jd;

  let gDayNo = jDayNo + 79;

  let gy = 1600 + 400 * Math.floor(gDayNo / 146097);
  gDayNo %= 146097;

  let leap = true;
  if (gDayNo >= 36525) {
    gDayNo -= 1;
    gy += 100 * Math.floor(gDayNo / 36524);
    gDayNo %= 36524;

    if (gDayNo >= 365) {
      gDayNo += 1;
    } else {
      leap = false;
    }
  }

  gy += 4 * Math.floor(gDayNo / 1461);
  gDayNo %= 1461;

  if (gDayNo >= 366) {
    leap = false;
    gDayNo -= 1;
    gy += Math.floor(gDayNo / 365);
    gDayNo %= 365;
  }

  const monthDays = [
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  let gm = 0;
  while (gm < monthDays.length && gDayNo >= monthDays[gm]) {
    gDayNo -= monthDays[gm];
    gm += 1;
  }

  return {
    year: gy,
    month: gm + 1,
    day: gDayNo + 1
  };
}

function persianDateTimeToUtc(dateFa, timeIran) {
  const normalizedDate = normalizePersianDigits(dateFa).trim();
  const normalizedTime = normalizePersianDigits(timeIran).trim();

  const dateMatch = normalizedDate.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  const timeMatch = normalizedTime.match(/^(\d{1,2}):(\d{2})$/);

  if (!dateMatch || !timeMatch) {
    return null;
  }

  const jy = Number(dateMatch[1]);
  const jm = Number(dateMatch[2]);
  const jd = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    jy < 1200 ||
    jy > 1700 ||
    jm < 1 ||
    jm > 12 ||
    jd < 1 ||
    jd > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const gregorian = jalaliToGregorian(jy, jm, jd);

  // Iran currently uses UTC+03:30 year-round. Construct local Tehran time,
  // then subtract the offset to produce UTC.
  const timestamp = Date.UTC(
    gregorian.year,
    gregorian.month - 1,
    gregorian.day,
    hour,
    minute
  ) - (3 * 60 + 30) * 60 * 1000;

  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function scoreValue(match, side) {
  const team = side === 'home' ? match?.host : match?.guest;
  const providerSide = side === 'home' ? 'host' : 'guest';
  const candidates = [
    match?.goals?.[providerSide],
    match?.goals?.[side],
    match?.score?.[providerSide],
    match?.score?.[side],
    team?.goals,
    team?.score
  ];

  for (const candidate of candidates) {
    const normalized = numericValue(candidate?.value ?? candidate);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function penaltyValue(match, side) {
  const team = side === 'home' ? match?.host : match?.guest;
  const providerSide = side === 'home' ? 'host' : 'guest';
  const candidates = [
    match?.penalties?.[providerSide],
    match?.penalties?.[side],
    match?.penalty?.[providerSide],
    match?.penalty?.[side],
    match?.penaltyGoals?.[providerSide],
    match?.penaltyGoals?.[side],
    team?.penalties,
    team?.penalty,
    team?.penaltyGoals
  ];

  for (const candidate of candidates) {
    const normalized = numericValue(candidate?.value ?? candidate);
    if (normalized !== null) {
      return normalized;
    }
  }
  return null;
}

function normalizeMatch(entry, context, identityMaps) {
  const match = entry.match;
  const status = normalizeStatus(match);
  if (!status) {
    return null;
  }

  const warnings = [];
  const externalHomeId = resolveTeamIdentity(match?.host, identityMaps);
  const externalAwayId = resolveTeamIdentity(match?.guest, identityMaps);
  const kickoffUtc =
    validKickoffUtc(match?.utcTime, entry.date?.utcTime) ||
    persianDateTimeToUtc(entry.date?.date, match?.time);

  if (!externalHomeId) {
    warnings.push('home_team_identity_unresolved');
  }
  if (!externalAwayId) {
    warnings.push('away_team_identity_unresolved');
  }
  if (!kickoffUtc) {
    warnings.push('kickoff_utc_unresolved');
  }

  return {
    id: stableId('match', PROVIDER_KEY, match.id),
    competition_key: context.competitionKey,
    season_key: context.seasonKey,
    provider: PROVIDER_KEY,
    external_match_id: match.id,
    home_external_team_id: externalHomeId,
    away_external_team_id: externalAwayId,
    home_team_id: externalHomeId
      ? stableId('team', PROVIDER_KEY, externalHomeId)
      : null,
    away_team_id: externalAwayId
      ? stableId('team', PROVIDER_KEY, externalAwayId)
      : null,
    home_name_fa: match?.host?.name ?? null,
    away_name_fa: match?.guest?.name ?? null,
    home_name_en: null,
    away_name_en: null,
    home_logo: match?.host?.logo ?? null,
    away_logo: match?.guest?.logo ?? null,
    kickoff_utc: kickoffUtc,
    date_fa: entry.date?.date ?? null,
    time_iran: match?.time ?? null,
    round: entry.round,
    status,
    is_live: status === 'live',
    live_phase: null,
    home_score: scoreValue(match, 'home'),
    away_score: scoreValue(match, 'away'),
    home_penalties: penaltyValue(match, 'home'),
    away_penalties: penaltyValue(match, 'away'),
    warnings
  };
}

function normalizeMatches(matchEntries, context, standing = null) {
  const identityMaps = buildIdentityMaps(matchEntries, standing);
  const matches = [];
  let skippedUnknownStatus = 0;

  for (const entry of matchEntries) {
    const normalized = normalizeMatch(entry, context, identityMaps);
    if (normalized) {
      matches.push(normalized);
    } else {
      skippedUnknownStatus += 1;
    }
  }

  return { matches, skippedUnknownStatus };
}

function normalizeStandingRow(row) {
  const externalId = directTeamIdentity(row);

  return {
    rank: numericValue(row.rank),
    team_id: externalId ? stableId('team', PROVIDER_KEY, externalId) : null,
    provider: PROVIDER_KEY,
    external_team_id: externalId,
    team_fa: row.name ?? null,
    team_en: null,
    logo: row.logo ?? null,
    played: numericValue(row.played),
    wins: numericValue(row.wins),
    draws: numericValue(row.draws),
    losses: numericValue(row.losses),
    points: numericValue(row.points),
    goals_for: numericValue(row.goalFor),
    goals_against: numericValue(row.goalAgainst),
    goal_difference: numericValue(row.goalDifference),
    qualification_color: row.qualificationColor ?? null,
    has_live_match: row.hasLiveMatch === true
  };
}

function normalizeStandings(standing) {
  return standing.teams.map(normalizeStandingRow);
}

function providerName(name) {
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim();
  return trimmed || null;
}

function providerLogo(logo) {
  return typeof logo === 'string' && logo.trim() ? logo : null;
}

function unresolvedTeamKey(team, sequence) {
  const name = identityName(team?.name);
  const logo = providerLogo(team?.logo) || '';
  return name ? `unresolved:${name}\u0000${logo}` : `unresolved-record:${sequence}`;
}

function teamRecord(team, context, identityMaps, rank, sequence) {
  const externalId = resolveTeamIdentity(team, identityMaps);
  return {
    key: externalId
      ? `resolved:${externalId}`
      : unresolvedTeamKey(team, sequence),
    rank: numericValue(rank),
    id: externalId ? stableId('team', PROVIDER_KEY, externalId) : null,
    competition_key: context.competitionKey,
    season_key: context.seasonKey,
    provider: PROVIDER_KEY,
    external_team_id: externalId,
    name_fa: providerName(team?.name),
    name_en: null,
    logo: providerLogo(team?.logo),
    warnings: externalId ? [] : ['team_identity_unresolved']
  };
}

function mergeMissingTeamMetadata(target, candidate) {
  if (target.name_fa === null && candidate.name_fa !== null) {
    target.name_fa = candidate.name_fa;
  }
  if (target.logo === null && candidate.logo !== null) {
    target.logo = candidate.logo;
  }
}

function compareTeams(left, right) {
  const leftRank = left.rank ?? Number.POSITIVE_INFINITY;
  const rightRank = right.rank ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const nameComparison = (left.name_fa || '').localeCompare(
    right.name_fa || '',
    'fa'
  );
  if (nameComparison !== 0) {
    return nameComparison;
  }

  const leftId = left.external_team_id ?? Number.POSITIVE_INFINITY;
  const rightId = right.external_team_id ?? Number.POSITIVE_INFINITY;
  if (leftId !== rightId) {
    return leftId - rightId;
  }

  return (left.logo || '').localeCompare(right.logo || '');
}

function normalizeTeams(standing, matchEntries, context) {
  const standingsAvailable =
    Array.isArray(standing?.teams) && standing.teams.length > 0;
  const identityMaps = buildIdentityMaps(matchEntries, standing);
  const records = new Map();
  let sequence = 0;

  for (const team of standingsAvailable ? standing.teams : []) {
    const candidate = teamRecord(
      team,
      context,
      identityMaps,
      team?.rank,
      sequence++
    );
    const existing = records.get(candidate.key);
    if (existing) {
      mergeMissingTeamMetadata(existing, candidate);
    } else {
      records.set(candidate.key, candidate);
    }
  }

  for (const entry of matchEntries) {
    for (const team of [entry.match?.host, entry.match?.guest]) {
      if (!team || typeof team !== 'object') {
        continue;
      }
      const candidate = teamRecord(
        team,
        context,
        identityMaps,
        null,
        sequence++
      );
      const existing = records.get(candidate.key);

      if (existing) {
        mergeMissingTeamMetadata(existing, candidate);
      } else if (!standingsAvailable) {
        records.set(candidate.key, candidate);
      }
    }
  }

  const teams = [...records.values()]
    .sort(compareTeams)
    .map(({ key, rank, ...team }) => team);
  const unresolvedTeamIdentities = teams.filter((team) => team.id === null).length;

  return { teams, unresolvedTeamIdentities };
}

function nonEmptyProviderValue(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return value === null || value === undefined ? null : value;
}

function normalizeMinute(value) {
  const rawMinute = nonEmptyProviderValue(value);
  if (rawMinute === null) {
    return { minute: null, rawMinute: null };
  }
  if (Number.isInteger(rawMinute) && rawMinute >= 0) {
    return { minute: rawMinute, rawMinute };
  }
  if (typeof rawMinute === 'string') {
    const match = rawMinute.match(/^(\d+)(?:\+\d+)?(?:['’])?$/);
    if (match) {
      return { minute: Number.parseInt(match[1], 10), rawMinute };
    }
  }
  return { minute: null, rawMinute };
}

function normalizeLivePhase(statusTitle, liveTime) {
  const explicit = `${statusTitle || ''} ${liveTime || ''}`
    .trim()
    .toLowerCase();
  if (!explicit) {
    return null;
  }

  if (/penalt|پنالتی/.test(explicit)) {
    return 'penalties';
  }
  if (
    /extra.?time.?half.?time|extra.?time.?break|استراحت وقت اضافه|پایان نیمه اول وقت اضافه/.test(
      explicit
    )
  ) {
    return 'extra_time_halftime';
  }
  if (/first half extra time|1st half extra time|نیمه اول وقت اضافه/.test(explicit)) {
    return 'extra_time_first_half';
  }
  if (/second half extra time|2nd half extra time|نیمه دوم وقت اضافه/.test(explicit)) {
    return 'extra_time_second_half';
  }
  if (/half.?time|بین دو نیمه|پایان نیمه اول/.test(explicit)) {
    return 'halftime';
  }
  if (/first half|1st half|نیمه اول/.test(explicit)) {
    return 'first_half';
  }
  if (/second half|2nd half|نیمه دوم/.test(explicit)) {
    return 'second_half';
  }
  if (/\bbreak\b|وقفه/.test(explicit)) {
    return 'break';
  }
  return null;
}

function liveOutputBase(snapshot) {
  return {
    id: snapshot.id,
    competition_key: snapshot.competition_key,
    season_key: snapshot.season_key,
    provider: snapshot.provider,
    external_match_id: snapshot.external_match_id,
    home_team_id: snapshot.home_team_id,
    away_team_id: snapshot.away_team_id,
    home_name_fa: snapshot.home_name_fa,
    away_name_fa: snapshot.away_name_fa,
    home_name_en: null,
    away_name_en: null,
    home_logo: snapshot.home_logo,
    away_logo: snapshot.away_logo,
    kickoff_utc: snapshot.kickoff_utc,
    date_fa: snapshot.date_fa,
    time_iran: snapshot.time_iran,
    round: snapshot.round,
    status: snapshot.status,
    is_live: snapshot.status === 'live',
    live_phase: null,
    minute: null,
    raw_minute: null,
    status_title: null,
    home_score: snapshot.home_score,
    away_score: snapshot.away_score,
    home_penalties: snapshot.home_penalties,
    away_penalties: snapshot.away_penalties,
    stale: false,
    warnings: [...new Set(snapshot.warnings || [])]
  };
}

function normalizeLiveMatch(snapshot, liveRecord = null, options = {}) {
  const output = liveOutputBase(snapshot);
  output.stale = options.stale === true;
  if (options.warning) {
    output.warnings = [...new Set([...output.warnings, options.warning])];
  }
  if (!liveRecord) {
    return output;
  }

  const liveStatus = normalizeStatus(liveRecord);
  const homeScore = scoreValue(liveRecord, 'home');
  const awayScore = scoreValue(liveRecord, 'away');
  const homePenalties = penaltyValue(liveRecord, 'home');
  const awayPenalties = penaltyValue(liveRecord, 'away');
  const statusTitle = nonEmptyProviderValue(liveRecord.statusTitle);
  const rawMinuteValue =
    nonEmptyProviderValue(liveRecord.liveTime) ??
    nonEmptyProviderValue(liveRecord.minute);
  const minute = normalizeMinute(rawMinuteValue);
  const liveKickoff = validKickoffUtc(
    liveRecord.startOnUtc,
    liveRecord.utcTime
  );

  output.home_name_fa =
    nonEmptyProviderValue(liveRecord.host?.name) ?? output.home_name_fa;
  output.away_name_fa =
    nonEmptyProviderValue(liveRecord.guest?.name) ?? output.away_name_fa;
  output.home_logo =
    nonEmptyProviderValue(liveRecord.host?.logo) ?? output.home_logo;
  output.away_logo =
    nonEmptyProviderValue(liveRecord.guest?.logo) ?? output.away_logo;
  output.kickoff_utc = liveKickoff ?? output.kickoff_utc;
  output.date_fa = nonEmptyProviderValue(liveRecord.date) ?? output.date_fa;
  output.time_iran = nonEmptyProviderValue(liveRecord.time) ?? output.time_iran;
  output.round = nonEmptyProviderValue(liveRecord.round) ?? output.round;
  output.status = liveStatus ?? output.status;
  output.is_live = output.status === 'live';
  output.live_phase = normalizeLivePhase(statusTitle, rawMinuteValue);
  output.minute = minute.minute;
  output.raw_minute = minute.rawMinute;
  output.status_title = statusTitle;
  output.home_score = homeScore ?? output.home_score;
  output.away_score = awayScore ?? output.away_score;
  output.home_penalties = homePenalties ?? output.home_penalties;
  output.away_penalties = awayPenalties ?? output.away_penalties;

  return output;
}

function eventTypeToken(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_-]+/g, ' ')
    : '';
}

function eventText(event, fields) {
  return fields
    .map((field) => eventTypeToken(event?.[field]))
    .filter(Boolean)
    .join(' ');
}

function isExplicitTrue(value) {
  return value === true || value === 1 || value === '1';
}

function isPenaltyShootoutEvent(event) {
  const text = eventText(event, [
    'type',
    'typeTitle',
    'title',
    'description',
    'eventTitle',
    'penaltyResultTitle',
    'phase',
    'stage',
    'scopeTitle'
  ]);
  return (
    numericValue(event?.scope) === 6 ||
    isExplicitTrue(event?.isPenaltyShootout) ||
    isExplicitTrue(event?.isShootout) ||
    eventTypeToken(event?.phase) === 'penalty shootout' ||
    /penalty shootout|shootout|ضربات پنالتی/.test(text)
  );
}

function hasExplicitSecondYellow(event) {
  if (
    isExplicitTrue(event?.isSecondYellow) ||
    isExplicitTrue(event?.secondYellow) ||
    isExplicitTrue(event?.isSecondYellowCard)
  ) {
    return true;
  }
  const text = eventText(event, [
    'type',
    'typeTitle',
    'cardType',
    'cardTypeTitle',
    'title',
    'description',
    'eventTitle',
    'name'
  ]);
  return /second yellow(?: card)?|yellow red|زرد دوم|دومین کارت زرد/.test(text);
}

function hasExplicitScoredPenalty(event) {
  if (
    [
      event?.isGoal,
      event?.isScored,
      event?.scored,
      event?.goal,
      event?.isSuccessful
    ].some(isExplicitTrue)
  ) {
    return true;
  }
  return [
    event?.result,
    event?.outcome,
    event?.decision,
    event?.penaltyResult,
    event?.penaltyResultTitle
  ].some((value) =>
    /^(?:goal|scored|successful|converted|گل|موفق)$/.test(
      eventTypeToken(value)
    )
  );
}

function normalizeEventType(event) {
  const rawType = event?.eventType ?? event?.type ?? event?.typeTitle;
  const numericType = numericValue(rawType);
  const type = eventTypeToken(rawType);
  const cardType = eventTypeToken(event?.cardType);
  const numericCardType = numericValue(event?.cardType);
  const numericPenaltyResult = numericValue(event?.penaltyResult);
  const text = eventText(event, [
    'type',
    'typeTitle',
    'goalType',
    'cardTypeTitle',
    'title',
    'description',
    'eventTitle',
    'decisionTitle',
    'name',
    'penaltyResultTitle'
  ]);

  if (isPenaltyShootoutEvent(event)) {
    return 'other';
  }
  if (
    numericType === 5 ||
    /goal disallowed|disallowed goal|var disallowed|گل مردود/.test(text)
  ) {
    return 'var';
  }
  if (hasExplicitSecondYellow(event)) {
    return 'second_yellow_red';
  }
  if (numericType === 7 || /own goal|گل به خودی/.test(text)) {
    return 'own_goal';
  }
  if (
    numericType === 8 ||
    numericCardType === 2 ||
    numericCardType === 3 ||
    /red card|کارت قرمز/.test(text) ||
    /red|قرمز/.test(cardType)
  ) {
    return 'red_card';
  }
  if (
    numericType === 2 ||
    numericCardType === 1 ||
    /yellow card|کارت زرد/.test(text) ||
    /yellow|زرد/.test(cardType)
  ) {
    return 'yellow_card';
  }
  const penaltyContext =
    numericType === 3 ||
    numericType === 9 ||
    /penalty|پنالتی/.test(text) ||
    /penalty|پنالتی/.test(type);
  if (
    numericType === 9 ||
    (penaltyContext && numericPenaltyResult === 3) ||
    (penaltyContext &&
      /missed|saved|failed|not scored|از دست|مهار|خراب|ناموفق/.test(text))
  ) {
    return 'missed_penalty';
  }
  if (
    penaltyContext &&
    (hasExplicitScoredPenalty(event) ||
      /penalty goal|گل پنالتی|(?:^| )(?:goal|scored|successful|converted)(?: |$)|گل|موفق/.test(
        text
      ))
  ) {
    return 'penalty_goal';
  }
  if (numericType === 3) {
    return 'other';
  }
  if (numericType === 1 || /^(goal|گل)$/.test(type)) {
    return 'goal';
  }
  if (numericType === 4 || /substitution|substitute|تعویض/.test(type)) {
    return 'substitution';
  }
  if (numericType === 6 || /^var$|video assistant|بازبینی ویدئویی/.test(type)) {
    return 'var';
  }
  if (numericType === 11 || /half.?time|پایان نیمه اول/.test(type)) {
    return 'halftime';
  }
  if (numericType === 12 || /full.?time|پایان بازی|پایان مسابقه/.test(type)) {
    return 'fulltime';
  }
  if (/kick.?off|شروع بازی/.test(type)) {
    return 'kickoff';
  }
  return 'other';
}

function explicitEventSide(value) {
  if (value === 0 || value === '0') {
    return 'home';
  }
  if (value === 1 || value === '1') {
    return 'away';
  }
  const normalized = eventTypeToken(value);
  if (normalized === 'home' || normalized === 'host') {
    return 'home';
  }
  if (normalized === 'away' || normalized === 'guest') {
    return 'away';
  }
  return null;
}

function resolveEventTeam(event, snapshot) {
  const explicitSide = explicitEventSide(
    event?.side ?? event?.teamSide ?? event?.sideTitle
  );
  if (explicitSide) {
    return {
      side: explicitSide,
      teamId:
        explicitSide === 'home'
          ? snapshot.home_team_id ?? null
          : snapshot.away_team_id ?? null
    };
  }

  const eventTeamId = externalTeamId(event?.teamId ?? event?.team?.id);
  const homeExternalId = externalTeamId(snapshot.home_external_team_id);
  const awayExternalId = externalTeamId(snapshot.away_external_team_id);
  if (eventTeamId && eventTeamId === homeExternalId) {
    return { side: 'home', teamId: snapshot.home_team_id ?? null };
  }
  if (eventTeamId && eventTeamId === awayExternalId) {
    return { side: 'away', teamId: snapshot.away_team_id ?? null };
  }

  const linkedTeamId = teamIdFromLink(event?.teamLink ?? event?.team?.link);
  if (linkedTeamId && linkedTeamId === homeExternalId) {
    return { side: 'home', teamId: snapshot.home_team_id ?? null };
  }
  if (linkedTeamId && linkedTeamId === awayExternalId) {
    return { side: 'away', teamId: snapshot.away_team_id ?? null };
  }
  return { side: null, teamId: null };
}

function normalizedProviderName(...values) {
  for (const value of values) {
    const normalized = nonEmptyProviderValue(value);
    if (normalized !== null) {
      return String(normalized).trim() || null;
    }
  }
  return null;
}

function rawEventType(event) {
  const value = event?.eventType ?? event?.type ?? event?.typeTitle;
  return typeof value === 'string' || typeof value === 'number' ? value : null;
}

function normalizedExternalEventId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }
  return typeof value === 'string' ? normalized : value;
}

function normalizeEvent(event, snapshot, originalIndex) {
  const normalizedType = normalizeEventType(event);
  const externalEventId = normalizedExternalEventId(event?.id);
  const minuteValue =
    nonEmptyProviderValue(event?.time) ??
    nonEmptyProviderValue(event?.rawTime) ??
    nonEmptyProviderValue(event?.minute) ??
    nonEmptyProviderValue(event?.eventTime);
  const minute = normalizeMinute(minuteValue);
  const team = resolveEventTeam(event, snapshot);
  const primaryPlayer =
    normalizedType === 'substitution'
      ? normalizedProviderName(event?.playerName)
      : normalizedProviderName(
          event?.playerName,
          event?.strickerName,
          event?.strikerName,
          event?.offendingPlayerName,
          event?.kickerName
        );
  const playerIn = normalizedProviderName(
    event?.incomingPlayerName,
    event?.playerInName
  );
  const playerOut = normalizedProviderName(
    event?.outgoingPlayerName,
    event?.playerOutName
  );
  const secondaryPlayer = normalizedProviderName(
    event?.assisterName,
    event?.assistName,
    event?.secondaryPlayerName
  );
  const teamSpecific =
    [
      'goal',
      'own_goal',
      'penalty_goal',
      'missed_penalty',
      'yellow_card',
      'second_yellow_red',
      'red_card',
      'substitution'
    ].includes(normalizedType) ||
    primaryPlayer !== null ||
    playerIn !== null ||
    playerOut !== null;
  const warnings = [];
  if (teamSpecific && (team.side === null || team.teamId === null)) {
    warnings.push('event_team_unresolved');
  }
  const scores = { goals: event?.matchResult ?? event?.score ?? event?.goals };
  const sequence = numericValue(
    event?.sequence ?? event?.order ?? event?.sortOrder
  );

  return {
    _originalIndex: originalIndex,
    _sequence: sequence,
    id: externalEventId
      ? stableId(
          'event',
          PROVIDER_KEY,
          `${snapshot.external_match_id}:${String(externalEventId)}`
        )
      : null,
    match_id: snapshot.id,
    competition_key: snapshot.competition_key,
    season_key: snapshot.season_key,
    provider: PROVIDER_KEY,
    external_event_id: externalEventId,
    normalized_type: normalizedType,
    raw_type: rawEventType(event),
    minute: minute.minute,
    raw_minute: minute.rawMinute,
    team_side: team.side,
    team_id: team.teamId,
    player_name_fa: primaryPlayer,
    player_name_en: null,
    secondary_player_name_fa: secondaryPlayer,
    secondary_player_name_en: null,
    player_in_name_fa: playerIn,
    player_in_name_en: null,
    player_out_name_fa: playerOut,
    player_out_name_en: null,
    home_score: scoreValue(scores, 'home'),
    away_score: scoreValue(scores, 'away'),
    is_scoring_event: ['goal', 'own_goal', 'penalty_goal'].includes(
      normalizedType
    ),
    description_fa: normalizedProviderName(event?.description),
    warnings
  };
}

function normalizeEvents(events, snapshot) {
  return events
    .map((event, index) => normalizeEvent(event, snapshot, index))
    .sort((left, right) => {
      const leftMinute = left.minute ?? Number.POSITIVE_INFINITY;
      const rightMinute = right.minute ?? Number.POSITIVE_INFINITY;
      if (leftMinute !== rightMinute) {
        return leftMinute - rightMinute;
      }
      const leftSequence = left._sequence ?? Number.POSITIVE_INFINITY;
      const rightSequence = right._sequence ?? Number.POSITIVE_INFINITY;
      if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }
      return left._originalIndex - right._originalIndex;
    })
    .map(({ _originalIndex, _sequence, ...event }) => event);
}

function hasUnresolvedMatchTeam(matchEntries) {
  const identityMaps = buildIdentityMaps(matchEntries, null);
  return matchEntries.some((entry) =>
    [entry.match?.host, entry.match?.guest].some(
      (team) => !resolveTeamIdentity(team, identityMaps)
    )
  );
}

module.exports = {
  buildIdentityMaps,
  directTeamIdentity,
  externalTeamId,
  hasUnresolvedMatchTeam,
  normalizeMatch,
  normalizeMatches,
  normalizeLiveMatch,
  normalizeLivePhase,
  normalizeMinute,
  normalizeEvent,
  normalizeEvents,
  normalizeEventType,
  normalizeStandingRow,
  normalizeStandings,
  normalizeTeams,
  normalizeStatus,
  penaltyValue,
  scoreValue,
  resolveEventTeam,
  teamIdFromLink,
  validKickoffUtc,
  persianDateTimeToUtc
};
