'use strict';

const { getConfig, requestJson, ProviderRequestError } = require('./httpClient');

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
          date: match.date ?? date?.date ?? null,
          provider_league_id: league.id,
          provider_sport: league.sport
        });
      }
    }
  }

  return [...matchesById.values()];
}

async function fetchTodayLivescore(options = {}) {
  return fetchLivescoreByOffset(0, options);
}

function offsetPath(offset) {
  if (!Number.isInteger(offset) || offset < -2 || offset > 2) {
    throw new RangeError('Unsupported livescore offset');
  }
  return offset === 0 ? 'today' : String(offset);
}

async function fetchLivescoreByOffset(offset, options = {}) {
  const path = offsetPath(offset);
  const request = options.requestJson || requestJson;
  const { baseUrl } = getConfig();
  const root = await request(`${baseUrl}/livescore/${path}`);
  if (!Array.isArray(root) && ![root?.leagues, root?.items, root?.data,
    root?.data?.leagues, root?.data?.items].some(Array.isArray)) {
    throw new ProviderRequestError('invalid_json');
  }
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

function createOffsetLivescoreCache(options = {}) {
  const now = options.now || Date.now;
  const fetchMatches = options.fetchMatches || fetchLivescoreByOffset;
  const caches = new Map();
  const dayFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  let day = null;
  function clear() {
    for (const cache of caches.values()) cache.clear();
    caches.clear();
  }
  function get(offset = 0) {
    offsetPath(offset);
    const currentDay = dayFormat.format(new Date(now()));
    if (currentDay !== day) {
      clear();
      day = currentDay;
    }
    if (!caches.has(offset)) {
      caches.set(offset, createLivescoreCache({
        ...options, now, fetchMatches: () => fetchMatches(offset)
      }));
    }
    return caches.get(offset).get();
  }
  return { get, clear };
}

const defaultCache = createOffsetLivescoreCache();

module.exports = {
  DEFAULT_LIVESCORE_CACHE_TTL_MS,
  clearLivescoreCache: defaultCache.clear,
  createLivescoreCache,
  createOffsetLivescoreCache,
  fetchLivescoreByOffset,
  getLivescoreByOffset: defaultCache.get,
  fetchTodayLivescore,
  flattenTodayLivescore,
  getTodayLivescore: () => defaultCache.get(0),
  normalizeProviderMatchId
};
