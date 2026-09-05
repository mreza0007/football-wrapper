'use strict';

const DEFAULT_OVERVIEW_CACHE_TTL_MS = 30000;
const DEFAULT_OVERVIEW_CACHE_MAX_ENTRIES = 100;

function configuredInteger(value, fallback, allowZero) {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0)
    ? parsed
    : fallback;
}

function overviewCacheConfig(env = process.env) {
  return {
    ttlMs: configuredInteger(
      env.VARZESH3_OVERVIEW_CACHE_TTL_MS,
      DEFAULT_OVERVIEW_CACHE_TTL_MS,
      true
    ),
    maxEntries: configuredInteger(
      env.VARZESH3_OVERVIEW_CACHE_MAX_ENTRIES,
      DEFAULT_OVERVIEW_CACHE_MAX_ENTRIES,
      false
    )
  };
}

function overviewCacheKey(competitionKey, seasonKey) {
  return JSON.stringify([
    String(competitionKey).trim().toLowerCase(),
    String(seasonKey).trim().toLowerCase()
  ]);
}

function createCompetitionOverviewCache(options = {}) {
  const configured = overviewCacheConfig(options.env || process.env);
  const now = options.now || Date.now;
  const ttlMs =
    Number.isSafeInteger(options.ttlMs) && options.ttlMs >= 0
      ? options.ttlMs
      : configured.ttlMs;
  const maxEntries =
    Number.isSafeInteger(options.maxEntries) && options.maxEntries > 0
      ? options.maxEntries
      : configured.maxEntries;
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

  async function get(competitionKey, seasonKey, fetcher) {
    if (typeof fetcher !== 'function') {
      throw new TypeError('Competition overview fetcher is required');
    }
    const key = overviewCacheKey(competitionKey, seasonKey);
    const existing = entries.get(key);
    if (existing && now() < existing.expiresAt) {
      touch(key, existing);
      return structuredClone(existing.value);
    }
    if (inFlight.has(key)) {
      return structuredClone(await inFlight.get(key));
    }

    const refreshGeneration = generation;
    const refresh = (async () => {
      const value = await fetcher();
      const snapshot = structuredClone(value);
      if (refreshGeneration === generation) {
        touch(key, { value: snapshot, expiresAt: now() + ttlMs });
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

  function clear() {
    entries.clear();
    inFlight.clear();
    generation += 1;
  }

  return { clear, get, size: () => entries.size };
}

module.exports = {
  DEFAULT_OVERVIEW_CACHE_MAX_ENTRIES,
  DEFAULT_OVERVIEW_CACHE_TTL_MS,
  createCompetitionOverviewCache,
  overviewCacheConfig,
  overviewCacheKey
};
