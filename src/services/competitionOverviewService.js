'use strict';

const varzesh3 = require('../providers/varzesh3');
const { ProviderRequestError } = require('../providers/varzesh3/httpClient');
const {
  StandingsUnavailableError
} = require('../providers/varzesh3/seasonData');
const matchLocatorService = require('./matchLocatorService');
const { PublicApiError } = require('./competitionDataService');
const {
  createCompetitionOverviewCache
} = require('./competitionOverviewCache');

const UPCOMING_LIMIT = 5;
const FINISHED_LIMIT = 5;
const defaultCache = createCompetitionOverviewCache();

function kickoffTimestamp(match) {
  if (
    typeof match?.kickoff_utc !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/i.test(match.kickoff_utc)
  ) {
    return null;
  }
  const timestamp = Date.parse(match.kickoff_utc);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareByKickoff(left, right, direction = 1) {
  const leftTimestamp = kickoffTimestamp(left);
  const rightTimestamp = kickoffTimestamp(right);
  if (leftTimestamp === null && rightTimestamp !== null) {
    return 1;
  }
  if (leftTimestamp !== null && rightTimestamp === null) {
    return -1;
  }
  if (leftTimestamp !== rightTimestamp) {
    return direction * (leftTimestamp - rightTimestamp);
  }
  const leftId = String(left.id);
  const rightId = String(right.id);
  if (leftId === rightId) {
    return 0;
  }
  return leftId < rightId ? -1 : 1;
}

function selectOverviewMatches(matches) {
  const source = Array.isArray(matches) ? matches : [];
  const live = source
    .filter((match) => match.status === 'live')
    .sort((left, right) => compareByKickoff(left, right));
  const upcoming = source
    .filter(
      (match) =>
        match.status === 'upcoming' && kickoffTimestamp(match) !== null
    )
    .sort((left, right) => compareByKickoff(left, right))
    .slice(0, UPCOMING_LIMIT);
  const finished = source
    .filter(
      (match) =>
        match.status === 'finished' && kickoffTimestamp(match) !== null
    )
    .sort((left, right) => compareByKickoff(left, right, -1))
    .slice(0, FINISHED_LIMIT);

  return [...live, ...upcoming, ...finished];
}

function publicMatch(match) {
  const {
    provider,
    external_match_id,
    home_external_team_id,
    away_external_team_id,
    ...safe
  } = match;
  return safe;
}

async function loadOverview(competitionKey, seasonKey) {
  const competition = varzesh3.getCompetitionMapping(competitionKey);
  const season = varzesh3.getSeasonMapping(competitionKey, seasonKey);

  try {
    const result = await varzesh3.fetchSeasonOverviewMatches(
      competition?.provider_league_id,
      season?.provider_season_id
    );
    let standing = null;
    if (varzesh3.hasUnresolvedMatchTeam(result.matches)) {
      try {
        standing = await varzesh3.getSeasonStandings(
          competition?.provider_league_id,
          season?.provider_season_id
        );
      } catch (error) {
        if (
          !(error instanceof ProviderRequestError) &&
          !(error instanceof StandingsUnavailableError)
        ) {
          throw error;
        }
      }
    }

    const normalized = varzesh3.normalizeMatches(
      result.matches,
      { competitionKey, seasonKey },
      standing
    );
    const warnings = [];
    if (normalized.skippedUnknownStatus > 0) {
      warnings.push(
        `provider_matches_skipped_unknown_status:${normalized.skippedUnknownStatus}`
      );
    }
    if (result.pageLimitReached) {
      warnings.push('provider_overview_page_limit_reached');
    }
    return {
      internalMatches: selectOverviewMatches(normalized.matches),
      warnings,
      stale: false
    };
  } catch (error) {
    if (error instanceof ProviderRequestError) {
      throw new PublicApiError(502, 'Provider unavailable');
    }
    throw error;
  }
}

async function getOverview(competitionKey, seasonKey) {
  const result = await defaultCache.get(competitionKey, seasonKey, () =>
    loadOverview(competitionKey, seasonKey)
  );
  matchLocatorService.indexMatches(result.internalMatches);
  return {
    matches: result.internalMatches.map(publicMatch),
    warnings: result.warnings,
    stale: result.stale
  };
}

module.exports = {
  FINISHED_LIMIT,
  UPCOMING_LIMIT,
  clearCompetitionOverviewCache: defaultCache.clear,
  getOverview,
  kickoffTimestamp,
  publicMatch,
  selectOverviewMatches
};
