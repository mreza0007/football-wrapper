'use strict';

const { getConfig, requestJson, ProviderRequestError } = require('./httpClient');

const MAX_PAGES = 50;

class StandingsUnavailableError extends Error {
  constructor() {
    super('Varzesh3 standings are unavailable');
    this.name = 'StandingsUnavailableError';
  }
}

function seasonPath(leagueId, seasonId) {
  return `/football/leagues/${leagueId}/seasons/${seasonId}`;
}

function buildEndpoint(leagueId, seasonId, resource) {
  const { baseUrl } = getConfig();
  return `${baseUrl}${seasonPath(leagueId, seasonId)}/${resource}`;
}

function isAllowedPaginationUrl(candidate, leagueId, seasonId) {
  try {
    const { baseUrl } = getConfig();
    const base = new URL(`${baseUrl}/`);
    const target = new URL(candidate, base);
    const expectedPath = `${base.pathname.replace(/\/$/, '')}${seasonPath(
      leagueId,
      seasonId
    )}/`;

    return target.origin === base.origin && target.pathname.startsWith(expectedPath);
  } catch {
    return false;
  }
}

function paginationLinks(page, leagueId, seasonId) {
  if (!Array.isArray(page?._links)) {
    return [];
  }

  const { baseUrl } = getConfig();
  return page._links
    .filter((link) => link?.rel === 'next' || link?.rel === 'prev')
    .map((link) => link?.href)
    .filter(
      (href) =>
        typeof href === 'string' &&
        isAllowedPaginationUrl(href, leagueId, seasonId)
    )
    .map((href) => new URL(href, `${baseUrl}/`).href);
}

function flattenMatches(page) {
  if (!Array.isArray(page?.items)) {
    return [];
  }

  const flattened = [];
  for (const item of page.items) {
    for (const date of Array.isArray(item?.dates) ? item.dates : []) {
      for (const match of Array.isArray(date?.matches) ? date.matches : []) {
        flattened.push({ match, round: item?.round ?? null, date });
      }
    }
  }
  return flattened;
}

async function fetchSeasonMatches(leagueId, seasonId, options = {}) {
  const request = options.requestJson || requestJson;
  const requestedMaxPages = options.maxPages ?? MAX_PAGES;
  const maxPages = Math.max(1, Math.min(MAX_PAGES, requestedMaxPages));
  const initialUrl = buildEndpoint(leagueId, seasonId, 'matches');
  const queue = [initialUrl];
  const queued = new Set(queue);
  const visited = new Set();
  const matchesById = new Map();

  while (queue.length > 0 && visited.size < maxPages) {
    const url = queue.shift();
    queued.delete(url);
    if (visited.has(url)) {
      continue;
    }

    visited.add(url);
    const page = await request(url);

    for (const entry of flattenMatches(page)) {
      const externalId = entry.match?.id;
      if (externalId !== undefined && externalId !== null) {
        const key = String(externalId);
        if (!matchesById.has(key)) {
          matchesById.set(key, entry);
        }
      }
    }

    for (const href of paginationLinks(page, leagueId, seasonId)) {
      if (!visited.has(href) && !queued.has(href)) {
        queue.push(href);
        queued.add(href);
      }
    }
  }

  return {
    matches: [...matchesById.values()],
    pagesFetched: visited.size,
    pageLimitReached: queue.length > 0
  };
}

async function fetchSeasonStandings(leagueId, seasonId, options = {}) {
  const request = options.requestJson || requestJson;
  const url = buildEndpoint(leagueId, seasonId, 'standing');

  try {
    const standing = await request(url);
    if (!standing || !Array.isArray(standing.teams)) {
      throw new StandingsUnavailableError();
    }
    return standing;
  } catch (error) {
    if (
      error instanceof StandingsUnavailableError ||
      (error instanceof ProviderRequestError && [404, 405, 410].includes(error.status))
    ) {
      throw new StandingsUnavailableError();
    }
    throw error;
  }
}

module.exports = {
  MAX_PAGES,
  StandingsUnavailableError,
  fetchSeasonMatches,
  fetchSeasonStandings,
  flattenMatches,
  isAllowedPaginationUrl,
  paginationLinks
};
