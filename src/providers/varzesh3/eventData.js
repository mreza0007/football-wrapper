'use strict';

const {
  getConfig,
  requestJson,
  ProviderRequestError
} = require('./httpClient');

const DEFAULT_EVENTS_CACHE_TTL_MS = 10000;
const DEFAULT_EVENTS_CACHE_MAX_ENTRIES = 500;

class EventsUnavailableError extends Error {
  constructor() {
    super('Events unavailable for match');
    this.name = 'EventsUnavailableError';
  }
}

function normalizeExternalMatchId(value) {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^\d+$/.test(value.trim()))
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function eventArray(root) {
  if (Array.isArray(root)) {
    return root;
  }
  if (!root || typeof root !== 'object') {
    return [];
  }
  for (const candidate of [root.events, root.items, root.data]) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  if (root.data && typeof root.data === 'object') {
    for (const candidate of [root.data.events, root.data.items]) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }
  return [];
}

function canonicalFingerprint(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalFingerprint).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalFingerprint(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function providerEventId(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function flattenEvents(root) {
  const seenIds = new Set();
  const seenFingerprints = new Set();
  const events = [];

  for (const event of eventArray(root)) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      continue;
    }
    const id = providerEventId(event.id);
    if (id) {
      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);
    } else {
      const fingerprint = canonicalFingerprint(event);
      if (seenFingerprints.has(fingerprint)) {
        continue;
      }
      seenFingerprints.add(fingerprint);
    }
    events.push(event);
  }

  return events;
}

async function fetchMatchEvents(externalMatchId, options = {}) {
  const normalizedId = normalizeExternalMatchId(externalMatchId);
  if (!normalizedId) {
    throw new TypeError('Invalid external match ID');
  }
  const request = options.requestJson || requestJson;
  const { baseUrl } = getConfig();

  try {
    const root = await request(
      `${baseUrl}/livescore/football/matches/${normalizedId}/events`
    );
    return flattenEvents(root);
  } catch (error) {
    if (
      error instanceof ProviderRequestError &&
      (error.status === 404 || error.status === 410)
    ) {
      throw new EventsUnavailableError();
    }
    throw error;
  }
}

function configuredPositiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createEventCache(options = {}) {
  const fetchEvents = options.fetchEvents || fetchMatchEvents;
  const now = options.now || Date.now;
  const requestedTtlMs =
    options.ttlMs ??
    configuredPositiveInteger(
      'VARZESH3_EVENTS_CACHE_TTL_MS',
      DEFAULT_EVENTS_CACHE_TTL_MS
    );
  const requestedMaxEntries =
    options.maxEntries ??
    configuredPositiveInteger(
      'VARZESH3_EVENTS_CACHE_MAX_ENTRIES',
      DEFAULT_EVENTS_CACHE_MAX_ENTRIES
    );
  const ttlMs =
    Number.isFinite(requestedTtlMs) && requestedTtlMs >= 0
      ? requestedTtlMs
      : DEFAULT_EVENTS_CACHE_TTL_MS;
  const maxEntries =
    Number.isSafeInteger(requestedMaxEntries) && requestedMaxEntries > 0
      ? requestedMaxEntries
      : DEFAULT_EVENTS_CACHE_MAX_ENTRIES;
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

  async function get(externalMatchId) {
    const normalizedId = normalizeExternalMatchId(externalMatchId);
    if (!normalizedId) {
      throw new TypeError('Invalid external match ID');
    }
    const key = String(normalizedId);
    const existing = entries.get(key);
    if (existing && now() < existing.expiresAt) {
      touch(key, existing);
      return { events: structuredClone(existing.events), stale: false };
    }
    if (inFlight.has(key)) {
      return structuredClone(await inFlight.get(key));
    }

    const refreshGeneration = generation;
    const refresh = (async () => {
      try {
        const events = await fetchEvents(normalizedId);
        const result = { events: structuredClone(events), stale: false };
        if (refreshGeneration === generation) {
          touch(key, {
            events: structuredClone(events),
            expiresAt: now() + ttlMs
          });
          enforceBound();
        }
        return result;
      } catch (error) {
        if (error instanceof ProviderRequestError && existing) {
          if (refreshGeneration === generation) {
            touch(key, existing);
          }
          return { events: structuredClone(existing.events), stale: true };
        }
        throw error;
      }
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

  function peek(externalMatchId) {
    const key = String(normalizeExternalMatchId(externalMatchId));
    const entry = entries.get(key);
    return entry ? structuredClone(entry.events) : null;
  }

  function size() {
    return entries.size;
  }

  return { clear, get, peek, size };
}

const defaultCache = createEventCache();

module.exports = {
  DEFAULT_EVENTS_CACHE_MAX_ENTRIES,
  DEFAULT_EVENTS_CACHE_TTL_MS,
  EventsUnavailableError,
  canonicalFingerprint,
  clearEventCache: defaultCache.clear,
  createEventCache,
  fetchMatchEvents,
  flattenEvents,
  getMatchEvents: defaultCache.get,
  normalizeExternalMatchId,
  providerEventId
};
