'use strict';

const varzesh3 = require('../providers/varzesh3');
const competitionService = require('./competitionService');
const seasonService = require('./seasonService');
const { PublicApiError } = require('./competitionDataService');
const { ProviderRequestError } = require('../providers/varzesh3/httpClient');

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit'
});
const DAY_MS = 86400000;

function dateTimestamp(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(date + 'T00:00:00Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date
    ? timestamp : null;
}

function tehranDate(timestamp) {
  return dayFormat.format(new Date(timestamp));
}

function dateOffset(date, now) {
  const timestamp = dateTimestamp(date);
  if (timestamp === null) throw new PublicApiError(400, 'Invalid date; use YYYY-MM-DD');
  const offset = (timestamp - dateTimestamp(tehranDate(now))) / DAY_MS;
  if (offset < -2 || offset > 2) {
    throw new PublicApiError(400, 'Date outside supported Tehran window (-2 to +2 days)');
  }
  return offset;
}

function dailyKickoff(value) {
  // Reject JS Date.parse's calendar rollover and timezone-naive inputs.
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!parts || dateTimestamp(parts[1]) === null ||
      Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) return null;
  if (parts[5].toUpperCase() !== 'Z' &&
      (Number(parts[5].slice(1, 3)) > 23 || Number(parts[5].slice(4)) > 59)) return null;
  return varzesh3.validKickoffUtc(value);
}

function supportedScopes() {
  const scopes = [];
  for (const competition of competitionService.getCompetitions()) {
    if (competition.is_active !== true || competition.capabilities?.supports_matches !== true) continue;
    const key = competition.competition_key;
    const season = seasonService.getSeason(key, competition.default_season_key);
    const mapping = varzesh3.getCompetitionMapping(key);
    if (!season || season.status !== 'active' || season.is_default !== true ||
        !varzesh3.getSeasonMapping(key, season.season_key) || !mapping?.provider_league_id) continue;
    scopes.push({ competition, season, leagueId: String(mapping.provider_league_id) });
  }
  // Ambiguous league ownership must not attach an invented season.
  return scopes.filter(scope => scopes.filter(other => other.leagueId === scope.leagueId).length === 1);
}

async function getMatchesByDate(date, options = {}) {
  const now = options.now || Date.now;
  const startedDay = tehranDate(now());
  const offset = dateOffset(date, now());
  let records;
  try {
    records = await varzesh3.getLivescoreByOffset(offset);
  } catch (error) {
    if (error instanceof ProviderRequestError) throw new PublicApiError(502, 'Provider unavailable');
    throw error;
  }
  if (!Array.isArray(records) || tehranDate(now()) !== startedDay) {
    throw new PublicApiError(502, 'Provider unavailable');
  }
  const seen = new Set();
  const selected = [];
  for (const record of records) {
    if (!record || !['string', 'number'].includes(typeof record.id) ||
        !/^\d+$/.test(String(record.id)) || seen.has(String(record.id))) continue;
    seen.add(String(record.id));
    if (record.provider_sport !== undefined && record.provider_sport !== 1) continue;
    const kickoff = dailyKickoff(record.startOnUtc);
    if (kickoff && tehranDate(Date.parse(kickoff)) === date) {
      selected.push({ record, kickoff });
    }
  }
  const groups = [];
  for (const { competition, season, leagueId } of supportedScopes()) {
    const entries = selected
      .filter(({ record }) => String(record.provider_league_id) === leagueId)
      .map(({ record, kickoff }) => ({
        match: { ...record, utcTime: kickoff },
        date: { date: record.date ?? null },
        round: record.round ?? null
      }));
    const normalized = varzesh3.normalizeMatches(entries, {
      competitionKey: competition.competition_key, seasonKey: season.season_key
    }).matches;
    const matches = normalized.map(match => {
      const { provider, external_match_id, home_external_team_id, away_external_team_id, ...safe } = match;
      return { ...safe, is_finished: safe.status === 'finished', is_upcoming: safe.status === 'upcoming' };
    });
    matches.sort((a, b) => Date.parse(a.kickoff_utc) - Date.parse(b.kickoff_utc) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (matches.length) groups.push({
      competition: {
        key: competition.competition_key, name: competition.name_en,
        name_fa: competition.name_fa, season_key: season.season_key, type: competition.type
      },
      matches
    });
  }
  return { date, groups, errors: [] };
}

module.exports = { getMatchesByDate, dateOffset, dailyKickoff, tehranDate };
