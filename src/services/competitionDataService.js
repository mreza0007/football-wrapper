'use strict';

const varzesh3 = require('../providers/varzesh3');
const { ProviderRequestError } = require('../providers/varzesh3/httpClient');
const {
  StandingsUnavailableError
} = require('../providers/varzesh3/seasonData');

class PublicApiError extends Error {
  constructor(status, publicMessage) {
    super(publicMessage);
    this.name = 'PublicApiError';
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

function mappingFor(competitionKey, seasonKey) {
  const competition = varzesh3.getCompetitionMapping(competitionKey);
  const season = varzesh3.getSeasonMapping(competitionKey, seasonKey);
  return {
    leagueId: competition?.provider_league_id,
    seasonId: season?.provider_season_id
  };
}

function providerUnavailable(error) {
  if (error instanceof ProviderRequestError) {
    throw new PublicApiError(502, 'Provider unavailable');
  }
  throw error;
}

async function getMatches(competitionKey, seasonKey, status = 'all') {
  const { leagueId, seasonId } = mappingFor(competitionKey, seasonKey);

  try {
    const result = await varzesh3.fetchSeasonMatches(leagueId, seasonId);
    let standing = null;

    if (varzesh3.hasUnresolvedMatchTeam(result.matches)) {
      try {
        standing = await varzesh3.fetchSeasonStandings(leagueId, seasonId);
      } catch (error) {
        if (
          error instanceof ProviderRequestError ||
          error instanceof StandingsUnavailableError
        ) {
          standing = null;
        } else {
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
      warnings.push('provider_page_limit_reached');
    }

    const matches =
      status === 'all'
        ? normalized.matches
        : normalized.matches.filter((match) => match.status === status);

    return { matches, warnings };
  } catch (error) {
    return providerUnavailable(error);
  }
}

async function getStandings(competitionKey, seasonKey) {
  const { leagueId, seasonId } = mappingFor(competitionKey, seasonKey);

  try {
    const standing = await varzesh3.fetchSeasonStandings(leagueId, seasonId);
    return varzesh3.normalizeStandings(standing);
  } catch (error) {
    if (error instanceof StandingsUnavailableError) {
      throw new PublicApiError(501, 'Standings not available');
    }
    return providerUnavailable(error);
  }
}

module.exports = { PublicApiError, getMatches, getStandings };
