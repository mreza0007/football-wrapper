'use strict';

const { getConfig, requestJson } = require('./httpClient');

const DEFAULT_LIVESCORE_CACHE_TTL_MS = 10000;

function normalizeProviderMatchId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function extractLeagues(root) {
  if (Array.isArray(root)) {
    return root;
  }
  if (!root || typeof root !== 'object') {
    return [];
  }

  for (const candidate of [root.leagues, root.items, root.data]) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (root.data && typeof root.data === 'object') {
    for (const candidate of [root.data.leagues, root.data.items]) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  return [];
}

function flattenTodayLivescore(root) {
  const matchesById = new Map();

  for (const league of extractLeagues(root)) {
    for (const date of Array.isArray(league?.dates) ? league.dates : []) {
      for (const match of Array.isArray(date?.matches) ? date.matches : []) {
        const id = normalizeProviderMatchId(match?.id);
        if (!id || matchesById.has(id)) {
          continue;
        }
        matchesById.set(id, {
          ...match,
          date: match.date ?? date?.date ?? null
        });
      }
    }
  }

  return [...matchesById.values()];
}

async function fetchTodayLivescore(options = {}) {
  const request = options.requestJson || requestJson;
  const { baseUrl } = getConfig();
  const root = await request(`${baseUrl}/livescore/today`);
  return flattenTodayLivescore(root);
}

function configuredCacheTtl() {
  const value = Number.parseInt(
    process.env.VARZESH3_LIVESCORE_CACHE_TTL_MS,
    10
  );
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_LIVESCORE_CACHE_TTL_MS;
}

function createLivescoreCache(options = {}) {
  const fetchMatches = options.fetchMatches || fetchTodayLivescore;
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs ?? configuredCacheTtl();
  let cached = null;
  let expiresAt = 0;
  let inFlight = null;
  let generation = 0;

  async function get() {
    if (cached !== null && now() < expiresAt) {
      return structuredClone(cached);
    }
    if (inFlight) {
      return structuredClone(await inFlight);
    }

    const refreshGeneration = generation;
    const refresh = (async () => {
      const matches = await fetchMatches();
      const snapshot = structuredClone(matches);
      if (refreshGeneration === generation) {
        cached = snapshot;
        expiresAt = now() + ttlMs;
      }
      return snapshot;
    })();
    inFlight = refresh;

    try {
      return structuredClone(await refresh);
    } finally {
      if (inFlight === refresh) {
        inFlight = null;
      }
    }
  }

  function clear() {
    cached = null;
    expiresAt = 0;
    inFlight = null;
    generation += 1;
  }

  function peek() {
    return cached === null ? null : structuredClone(cached);
  }

  return { clear, get, peek };
}

const defaultCache = createLivescoreCache();

module.exports = {
  DEFAULT_LIVESCORE_CACHE_TTL_MS,
  clearLivescoreCache: defaultCache.clear,
  createLivescoreCache,
  fetchTodayLivescore,
  flattenTodayLivescore,
  getTodayLivescore: defaultCache.get,
  normalizeProviderMatchId
};
