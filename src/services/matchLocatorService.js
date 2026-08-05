'use strict';

const competitionService = require('./competitionService');
const seasonService = require('./seasonService');

const DEFAULT_MATCH_INDEX_TTL_MS = 300000;
const MATCH_ID_PATTERN = /^mp_match_[a-f0-9]{24}$/;

class MatchNotFoundError extends Error {
  constructor() {
    super('Match not found');
    this.name = 'MatchNotFoundError';
    this.status = 404;
    this.publicMessage = 'Match not found';
  }
}

class MatchLookupProviderError extends Error {
  constructor() {
    super('Provider unavailable');
    this.name = 'MatchLookupProviderError';
    this.status = 502;
    this.publicMessage = 'Provider unavailable';
  }
}

function configuredIndexTtl() {
  const value = Number.parseInt(process.env.MATCH_INDEX_TTL_MS, 10);
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_MATCH_INDEX_TTL_MS;
}

function configuredMatchSeasons() {
  const configured = [];
  for (const competition of competitionService.getCompetitions()) {
    if (
      competition.is_active !== true ||
      competition.capabilities?.supports_matches !== true
    ) {
      continue;
    }
    for (const season of seasonService.getSeasons(competition.competition_key)) {
      if (
        season.is_active === false ||
        season.capabilities?.supports_matches !== true
      ) {
        continue;
      }
      configured.push({
        competitionKey: competition.competition_key,
        seasonKey: season.season_key
      });
    }
  }
  return configured;
}

async function loadConfiguredMatches() {
  const competitionDataService = require('./competitionDataService');
  const requests = configuredMatchSeasons().map(({ competitionKey, seasonKey }) =>
    competitionDataService.getMatches(competitionKey, seasonKey, 'all')
  );
  const results = await Promise.allSettled(requests);
  const matches = [];
  let providerFailure = false;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      matches.push(...result.value.matches);
      continue;
    }
    if (
      result.reason?.status === 502 &&
      result.reason?.publicMessage === 'Provider unavailable'
    ) {
      providerFailure = true;
      continue;
    }
    throw result.reason;
  }

  return { matches, providerFailure };
}

function createMatchLocator(options = {}) {
  const loadMatches = options.loadMatches || loadConfiguredMatches;
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs ?? configuredIndexTtl();
  const entries = new Map();
  let refreshPromise = null;

  function indexMatches(matches) {
    const indexedIds = new Set();
    const indexedAt = now();
    for (const snapshot of Array.isArray(matches) ? matches : []) {
      if (!MATCH_ID_PATTERN.test(snapshot?.id || '')) {
        continue;
      }
      entries.set(snapshot.id, {
        competition_key: snapshot.competition_key,
        season_key: snapshot.season_key,
        provider: snapshot.provider,
        external_match_id: snapshot.external_match_id,
        snapshot: structuredClone(snapshot),
        expiresAt: indexedAt + ttlMs
      });
      indexedIds.add(snapshot.id);
    }
    return indexedIds;
  }

  async function refresh() {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      const result = await loadMatches();
      return {
        refreshedIds: indexMatches(result?.matches || []),
        providerFailure: result?.providerFailure === true
      };
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  async function resolve(matchId) {
    if (
      typeof matchId !== 'string' ||
      matchId !== matchId.trim() ||
      !MATCH_ID_PATTERN.test(matchId)
    ) {
      throw new MatchNotFoundError();
    }
    const normalizedId = matchId;
    const current = entries.get(normalizedId);
    if (current && now() < current.expiresAt) {
      return structuredClone(current);
    }

    const result = await refresh();
    const refreshed = entries.get(normalizedId);
    if (refreshed && result.refreshedIds.has(normalizedId)) {
      return structuredClone(refreshed);
    }
    if (result.providerFailure) {
      throw new MatchLookupProviderError();
    }
    throw new MatchNotFoundError();
  }

  function clear() {
    entries.clear();
    refreshPromise = null;
  }

  return { clear, indexMatches, resolve };
}

const defaultLocator = createMatchLocator();

module.exports = {
  DEFAULT_MATCH_INDEX_TTL_MS,
  MATCH_ID_PATTERN,
  MatchLookupProviderError,
  MatchNotFoundError,
  clearMatchIndex: defaultLocator.clear,
  createMatchLocator,
  indexMatches: defaultLocator.indexMatches,
  resolveMatch: defaultLocator.resolve
};
