'use strict';

const competitionService = require('./competitionService');
const seasonService = require('./seasonService');
const varzesh3 = require('../providers/varzesh3');
const { logger: defaultLogger, safeErrorName } = require('../utils/logger');

const DEFAULT_PREWARM_CONCURRENCY = 2;

function isActive(record) {
  return record?.status === 'active' && record?.is_active !== false;
}

function discoverActiveSeasonMatchScopes(options = {}) {
  const competitionDirectory =
    options.competitionService || competitionService;
  const seasonDirectory = options.seasonService || seasonService;
  const provider = options.provider || varzesh3;
  const scopesByProviderIdentity = new Map();

  for (const competition of competitionDirectory.getCompetitions()) {
    if (!isActive(competition)) {
      continue;
    }

    for (const season of seasonDirectory.getSeasons(
      competition.competition_key
    )) {
      if (!isActive(season)) {
        continue;
      }

      const competitionMapping = provider.getCompetitionMapping(
        competition.competition_key
      );
      const seasonMapping = provider.getSeasonMapping(
        competition.competition_key,
        season.season_key
      );
      const leagueId = competitionMapping?.provider_league_id;
      const seasonId = seasonMapping?.provider_season_id;
      if (leagueId === undefined || seasonId === undefined) {
        continue;
      }

      const identity = JSON.stringify([
        provider.providerKey,
        String(leagueId),
        String(seasonId)
      ]);
      const existing = scopesByProviderIdentity.get(identity);
      if (existing) {
        existing.competitionKeys.push(competition.competition_key);
        existing.seasonKeys.push(season.season_key);
        continue;
      }

      scopesByProviderIdentity.set(identity, {
        competitionKeys: [competition.competition_key],
        seasonKeys: [season.season_key],
        leagueId,
        seasonId
      });
    }
  }

  return [...scopesByProviderIdentity.values()];
}

function warning(logger, event, fields) {
  const write = typeof logger.warn === 'function' ? logger.warn : logger.error;
  write.call(logger, event, fields);
}

async function prewarmActiveSeasonMatches(options = {}) {
  const provider = options.provider || varzesh3;
  const logger = options.logger || defaultLogger;
  const now = options.now || Date.now;
  const configuredConcurrency = Number.isSafeInteger(options.concurrency) &&
    options.concurrency > 0
    ? options.concurrency
    : DEFAULT_PREWARM_CONCURRENCY;
  const scopes = discoverActiveSeasonMatchScopes({
    competitionService: options.competitionService,
    seasonService: options.seasonService,
    provider
  });
  const concurrency = Math.min(configuredConcurrency, scopes.length);
  const startedAt = now();
  let nextIndex = 0;
  let succeeded = 0;
  let failed = 0;

  logger.info('season_matches_prewarm_started', {
    scope_count: scopes.length,
    concurrency
  });

  async function worker() {
    while (nextIndex < scopes.length) {
      const scope = scopes[nextIndex];
      nextIndex += 1;

      const fields = {
        competition_key: scope.competitionKeys.join(','),
        season_key: scope.seasonKeys.join(',')
      };
      try {
        await provider.getSeasonMatches(scope.leagueId, scope.seasonId);
        succeeded += 1;
        logger.info('season_matches_prewarm_scope_succeeded', fields);
      } catch (error) {
        failed += 1;
        warning(logger, 'season_matches_prewarm_scope_failed', {
          ...fields,
          error_name: safeErrorName(error)
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker())
  );

  const summary = {
    scopeCount: scopes.length,
    succeeded,
    failed,
    durationMs: Math.max(0, now() - startedAt)
  };
  logger.info('season_matches_prewarm_completed', {
    scope_count: summary.scopeCount,
    succeeded: summary.succeeded,
    failed: summary.failed,
    duration_ms: summary.durationMs
  });
  return summary;
}

module.exports = {
  DEFAULT_PREWARM_CONCURRENCY,
  discoverActiveSeasonMatchScopes,
  prewarmActiveSeasonMatches
};
