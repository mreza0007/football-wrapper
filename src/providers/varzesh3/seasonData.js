'use strict';

const { getConfig, requestJson, ProviderRequestError } = require('./httpClient');

const MAX_PAGES = 50;
const DEFAULT_OVERVIEW_MAX_PAGES = 5;
const OVERVIEW_UPCOMING_LIMIT = 5;
const OVERVIEW_FINISHED_LIMIT = 5;

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

function overviewPaginationLink(page, relation, leagueId, seasonId) {
  if (!Array.isArray(page?._links) || !['next', 'prev'].includes(relation)) {
    return null;
  }

  const expectedResource = relation === 'next' ? 'fixtures' : 'results';
  const { baseUrl } = getConfig();
  const expectedSuffix = `${seasonPath(leagueId, seasonId)}/${expectedResource}`;

  for (const link of page._links) {
    if (
      link?.rel !== relation ||
      typeof link?.href !== 'string' ||
      !isAllowedPaginationUrl(link.href, leagueId, seasonId)
    ) {
      continue;
    }

    const target = new URL(link.href, `${baseUrl}/`);
    if (target.pathname.endsWith(expectedSuffix)) {
      return target.href;
    }
  }

  return null;
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

function overviewCounts(entries) {
  const {
    normalizeStatus,
    persianDateTimeToUtc,
    validKickoffUtc
  } = require('./normalizers');
  let upcoming = 0;
  let finished = 0;

  for (const entry of entries) {
    const status = normalizeStatus(entry.match);
    if (status !== 'upcoming' && status !== 'finished') {
      continue;
    }
    const kickoff =
      validKickoffUtc(entry.match?.utcTime, entry.date?.utcTime) ||
      persianDateTimeToUtc(entry.date?.date, entry.match?.time);
    if (!kickoff) {
      continue;
    }
    if (status === 'upcoming') {
      upcoming += 1;
    } else {
      finished += 1;
    }
  }

  return { upcoming, finished };
}

async function fetchSeasonOverviewMatches(leagueId, seasonId, options = {}) {
  const request = options.requestJson || requestJson;
  const requestedMaxPages = options.maxPages ?? DEFAULT_OVERVIEW_MAX_PAGES;
  const maxPages = Math.max(
    1,
    Math.min(DEFAULT_OVERVIEW_MAX_PAGES, requestedMaxPages)
  );
  const matchesById = new Map();
  const visited = new Set();
  const links = { next: null, prev: null };

  async function fetchPage(url, relation = null) {
    if (!url || visited.has(url) || visited.size >= maxPages) {
      return false;
    }
    visited.add(url);
    const page = await request(url);
    for (const entry of flattenMatches(page)) {
      const externalId = entry.match?.id;
      if (externalId === undefined || externalId === null) {
        continue;
      }
      const key = String(externalId);
      if (!matchesById.has(key)) {
        matchesById.set(key, entry);
      }
    }

    if (relation === null || relation === 'next') {
      links.next = overviewPaginationLink(page, 'next', leagueId, seasonId);
    }
    if (relation === null || relation === 'prev') {
      links.prev = overviewPaginationLink(page, 'prev', leagueId, seasonId);
    }
    return true;
  }

  await fetchPage(buildEndpoint(leagueId, seasonId, 'matches'));

  while (visited.size < maxPages) {
    const counts = overviewCounts([...matchesById.values()]);
    const needsNext =
      counts.upcoming < OVERVIEW_UPCOMING_LIMIT && Boolean(links.next);
    const needsPrev =
      counts.finished < OVERVIEW_FINISHED_LIMIT && Boolean(links.prev);
    if (!needsNext && !needsPrev) {
      break;
    }

    let fetched = false;
    if (needsNext && visited.size < maxPages) {
      const nextUrl = links.next;
      links.next = null;
      fetched = (await fetchPage(nextUrl, 'next')) || fetched;
    }
    const refreshedCounts = overviewCounts([...matchesById.values()]);
    const stillNeedsPrev =
      refreshedCounts.finished < OVERVIEW_FINISHED_LIMIT && Boolean(links.prev);
    if (stillNeedsPrev && visited.size < maxPages) {
      const prevUrl = links.prev;
      links.prev = null;
      fetched = (await fetchPage(prevUrl, 'prev')) || fetched;
    }
    if (!fetched) {
      break;
    }
  }

  const counts = overviewCounts([...matchesById.values()]);
  return {
    matches: [...matchesById.values()],
    pagesFetched: visited.size,
    pageLimitReached:
      visited.size >= maxPages &&
      ((counts.upcoming < OVERVIEW_UPCOMING_LIMIT && Boolean(links.next)) ||
        (counts.finished < OVERVIEW_FINISHED_LIMIT && Boolean(links.prev)))
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
  DEFAULT_OVERVIEW_MAX_PAGES,
  MAX_PAGES,
  OVERVIEW_FINISHED_LIMIT,
  OVERVIEW_UPCOMING_LIMIT,
  StandingsUnavailableError,
  fetchSeasonOverviewMatches,
  fetchSeasonMatches,
  fetchSeasonStandings,
  flattenMatches,
  isAllowedPaginationUrl,
  overviewCounts,
  overviewPaginationLink,
  paginationLinks
};
