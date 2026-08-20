'use strict';

const DEFAULT_SEASON_MATCHES_CACHE_TTL_MS = 30000;
const DEFAULT_STANDINGS_CACHE_TTL_MS = 30000;
const DEFAULT_SEASON_CACHE_MAX_ENTRIES = 100;

function configuredNonNegativeInteger(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function configuredPositiveInteger(value, fallback) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function seasonCacheConfig(env = process.env) {
  return {
    matchesTtlMs: configuredNonNegativeInteger(
      env.VARZESH3_SEASON_MATCHES_CACHE_TTL_MS,
      DEFAULT_SEASON_MATCHES_CACHE_TTL_MS
    ),
    standingsTtlMs: configuredNonNegativeInteger(
      env.VARZESH3_STANDINGS_CACHE_TTL_MS,
      DEFAULT_STANDINGS_CACHE_TTL_MS
    ),
    maxEntries: configuredPositiveInteger(
      env.VARZESH3_SEASON_CACHE_MAX_ENTRIES,
      DEFAULT_SEASON_CACHE_MAX_ENTRIES
    )
  };
}

function normalizedCacheKey(provider, dataType, leagueId, seasonId) {
  return JSON.stringify([
    String(provider).trim().toLowerCase(),
    dataType,
    String(leagueId),
    String(seasonId)
  ]);
}

function validNonNegativeInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function validPositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createSeasonDataCache(options = {}) {
  const configured = seasonCacheConfig(options.env || process.env);
  const fetchMatches = options.fetchMatches;
  const fetchStandings = options.fetchStandings;
  const now = options.now || Date.now;
  const matchesTtlMs = validNonNegativeInteger(
    options.matchesTtlMs,
    configured.matchesTtlMs
  );
  const standingsTtlMs = validNonNegativeInteger(
    options.standingsTtlMs,
    configured.standingsTtlMs
  );
  const maxEntries = validPositiveInteger(
    options.maxEntries,
    configured.maxEntries
  );
  const entries = new Map();
  const inFlight = new Map();
  let generation = 0;

  function touch(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
  }

  function enforceBound() {
    while (entries.size > maxEntries) {
      entries.delete(entries.keys().next().value);
    }
  }

  async function get(dataType, provider, leagueId, seasonId, fetcher) {
    const key = normalizedCacheKey(provider, dataType, leagueId, seasonId);
    const existing = entries.get(key);
    if (existing && now() < existing.expiresAt) {
      touch(key, existing);
      return structuredClone(existing.value);
    }
    if (inFlight.has(key)) {
      return structuredClone(await inFlight.get(key));
    }

    const refreshGeneration = generation;
    const ttlMs = dataType === 'matches' ? matchesTtlMs : standingsTtlMs;
    const refresh = (async () => {
      const value = await fetcher(leagueId, seasonId);
      const snapshot = structuredClone(value);
      if (refreshGeneration === generation) {
        touch(key, {
          value: snapshot,
          expiresAt: now() + ttlMs
        });
        enforceBound();
      }
      return snapshot;
    })();
    inFlight.set(key, refresh);

    try {
      return structuredClone(await refresh);
    } finally {
      if (inFlight.get(key) === refresh) {
        inFlight.delete(key);
      }
    }
  }

  function getMatches(provider, leagueId, seasonId, fetcher = fetchMatches) {
    if (typeof fetcher !== 'function') {
      throw new TypeError('Season matches fetcher is required');
    }
    return get('matches', provider, leagueId, seasonId, fetcher);
  }

  function getStandings(provider, leagueId, seasonId, fetcher = fetchStandings) {
    if (typeof fetcher !== 'function') {
      throw new TypeError('Season standings fetcher is required');
    }
    return get('standings', provider, leagueId, seasonId, fetcher);
  }

  function clear() {
    entries.clear();
    inFlight.clear();
    generation += 1;
  }

  function peek(dataType, provider, leagueId, seasonId) {
    const key = normalizedCacheKey(provider, dataType, leagueId, seasonId);
    const entry = entries.get(key);
    return entry ? structuredClone(entry.value) : null;
  }

  function keys() {
    return [...entries.keys()];
  }

  function size() {
    return entries.size;
  }

  return { clear, getMatches, getStandings, keys, peek, size };
}

module.exports = {
  DEFAULT_SEASON_CACHE_MAX_ENTRIES,
  DEFAULT_SEASON_MATCHES_CACHE_TTL_MS,
  DEFAULT_STANDINGS_CACHE_TTL_MS,
  createSeasonDataCache,
  normalizedCacheKey,
  seasonCacheConfig
};
