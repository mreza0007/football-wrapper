'use strict';

const { isDeepStrictEqual } = require('node:util');
const competitionService = require('./competitionService');
const seasonService = require('./seasonService');

const DEFAULT_MATCH_INDEX_TTL_MS = 300000;
const DEFAULT_MATCH_INDEX_REFRESH_GUARD_MS = 30000;
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

function configuredRefreshGuard() {
  const configured = process.env.MATCH_INDEX_REFRESH_GUARD_MS;
  if (typeof configured !== 'string' || configured.trim() === '') {
    return DEFAULT_MATCH_INDEX_REFRESH_GUARD_MS;
  }
  const value = Number(configured);
  return Number.isSafeInteger(value) && value >= 0
    ? value
    : DEFAULT_MATCH_INDEX_REFRESH_GUARD_MS;
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
  const configuredScopes = configuredMatchSeasons();
  const requests = configuredScopes.map(({ competitionKey, seasonKey }) =>
    competitionDataService.getMatches(competitionKey, seasonKey, 'all')
  );
  const results = await Promise.allSettled(requests);
  const matches = [];
  const scopes = [];
  let providerFailure = false;

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const scope = configuredScopes[index];
    if (result.status === 'fulfilled') {
      matches.push(...result.value.matches);
      scopes.push({ ...scope, succeeded: true, matches: result.value.matches });
      continue;
    }
    if (
      result.reason?.status === 502 &&
      result.reason?.publicMessage === 'Provider unavailable'
    ) {
      providerFailure = true;
      scopes.push({ ...scope, succeeded: false, matches: [] });
      continue;
    }
    throw result.reason;
  }

  return {
    matches,
    scopes,
    providerFailure,
    completeSuccess:
      scopes.length === configuredScopes.length &&
      scopes.every((scope) => scope.succeeded)
  };
}

function createMatchLocator(options = {}) {
  const loadMatches = options.loadMatches || loadConfiguredMatches;
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs ?? configuredIndexTtl();
  const refreshGuardMs = options.refreshGuardMs ?? configuredRefreshGuard();
  const entries = new Map();
  let refreshPromise = null;
  let lastSuccessfulFullRefreshAt = null;

  function entryFor(snapshot, indexedAt) {
    return {
      competition_key: snapshot.competition_key,
      season_key: snapshot.season_key,
      provider: snapshot.provider,
      external_match_id: snapshot.external_match_id,
      snapshot: structuredClone(snapshot),
      expiresAt: indexedAt + ttlMs
    };
  }

  function indexMatches(matches) {
    const indexedIds = new Set();
    const indexedAt = now();
    for (const snapshot of Array.isArray(matches) ? matches : []) {
      if (!MATCH_ID_PATTERN.test(snapshot?.id || '')) {
        continue;
      }
      const existing = entries.get(snapshot.id);
      if (existing && isDeepStrictEqual(existing.snapshot, snapshot)) {
        indexedIds.add(snapshot.id);
        continue;
      }
      entries.set(snapshot.id, entryFor(snapshot, indexedAt));
      indexedIds.add(snapshot.id);
    }
    return indexedIds;
  }

  function replaceScope(competitionKey, seasonKey, matches) {
    const indexedAt = now();
    const validSnapshots = (Array.isArray(matches) ? matches : []).filter(
      (snapshot) => MATCH_ID_PATTERN.test(snapshot?.id || '')
    );
    const refreshedIds = new Set(validSnapshots.map((snapshot) => snapshot.id));

    for (const [matchId, entry] of entries) {
      if (
        entry.competition_key === competitionKey &&
        entry.season_key === seasonKey &&
        !refreshedIds.has(matchId)
      ) {
        entries.delete(matchId);
      }
    }
    for (const snapshot of validSnapshots) {
      entries.set(snapshot.id, entryFor(snapshot, indexedAt));
    }
    return refreshedIds;
  }

  function applyRefreshResult(result = {}) {
    const refreshedIds = new Set();
    const providerFailure = result.providerFailure === true;

    if (Array.isArray(result.scopes)) {
      for (const scope of result.scopes) {
        if (scope?.succeeded !== true) {
          continue;
        }
        for (const matchId of replaceScope(
          scope.competitionKey,
          scope.seasonKey,
          scope.matches
        )) {
          refreshedIds.add(matchId);
        }
      }
    } else {
      for (const matchId of indexMatches(result.matches || [])) {
        refreshedIds.add(matchId);
      }
    }

    const completeSuccess = Array.isArray(result.scopes)
      ? !providerFailure &&
        result.completeSuccess === true &&
        result.scopes.every((scope) => scope?.succeeded === true)
      : !providerFailure && result.completeSuccess !== false;
    if (completeSuccess) {
      lastSuccessfulFullRefreshAt = now();
    }
    return { completeSuccess, providerFailure, refreshedIds };
  }

  async function refresh() {
    if (refreshPromise) {
      return refreshPromise;
    }

    refreshPromise = (async () => {
      const result = await loadMatches();
      return applyRefreshResult(result);
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
    if (
      !current &&
      lastSuccessfulFullRefreshAt !== null &&
      now() - lastSuccessfulFullRefreshAt < refreshGuardMs
    ) {
      throw new MatchNotFoundError();
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
    lastSuccessfulFullRefreshAt = null;
  }

  return { clear, indexMatches, replaceScope, resolve };
}

const defaultLocator = createMatchLocator();

module.exports = {
  DEFAULT_MATCH_INDEX_TTL_MS,
  DEFAULT_MATCH_INDEX_REFRESH_GUARD_MS,
  MATCH_ID_PATTERN,
  MatchLookupProviderError,
  MatchNotFoundError,
  clearMatchIndex: defaultLocator.clear,
  createMatchLocator,
  indexMatches: defaultLocator.indexMatches,
  replaceMatchScope: defaultLocator.replaceScope,
  resolveMatch: defaultLocator.resolve
};
