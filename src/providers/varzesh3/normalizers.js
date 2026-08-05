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
  const kickoffUtc = validKickoffUtc(match?.utcTime, entry.date?.utcTime);

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
  normalizeStandingRow,
  normalizeStandings,
  normalizeTeams,
  normalizeStatus,
  penaltyValue,
  scoreValue,
  teamIdFromLink,
  validKickoffUtc
};
