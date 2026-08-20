'use strict';

const varzesh3 = require('../providers/varzesh3');
const matchLocatorService = require('./matchLocatorService');
const { ProviderRequestError } = require('../providers/varzesh3/httpClient');

function matchesExternalId(liveRecord, externalMatchId) {
  const liveId = varzesh3.normalizeProviderMatchId(liveRecord?.id);
  const seasonId = varzesh3.normalizeProviderMatchId(externalMatchId);
  return liveId !== null && seasonId !== null && liveId === seasonId;
}

function liveCount(matches) {
  return matches.filter((match) => varzesh3.normalizeStatus(match) === 'live')
    .length;
}

async function getLiveMatch(matchId) {
  const locator = await matchLocatorService.resolveMatch(matchId);
  const snapshot = locator.snapshot;

  try {
    const todayMatches = await varzesh3.getTodayLivescore();
    const liveRecord = todayMatches.find((match) =>
      matchesExternalId(match, locator.external_match_id)
    );
    const todayLiveMatchCount = liveCount(todayMatches);

    if (!liveRecord) {
      return {
        match: varzesh3.normalizeLiveMatch(snapshot, null, {
          warning: 'live_record_not_found_using_season_snapshot'
        }),
        mode: 'season_snapshot',
        todayLivescoreMatchCount: todayMatches.length,
        todayLiveMatchCount
      };
    }

    return {
      match: varzesh3.normalizeLiveMatch(snapshot, liveRecord),
      mode: 'live_feed',
      todayLivescoreMatchCount: todayMatches.length,
      todayLiveMatchCount
    };
  } catch (error) {
    if (!(error instanceof ProviderRequestError)) {
      throw error;
    }
    return {
      match: varzesh3.normalizeLiveMatch(snapshot, null, {
        stale: true,
        warning: 'live_provider_unavailable_using_season_snapshot'
      }),
      mode: 'stale_season_snapshot',
      todayLivescoreMatchCount: null,
      todayLiveMatchCount: null
    };
  }
}

module.exports = { getLiveMatch, matchesExternalId };
