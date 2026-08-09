'use strict';

const competitionMap = require('./competitionMap');
const seasonData = require('./seasonData');
const seasonDataCache = require('./seasonDataCache');
const normalizers = require('./normalizers');
const liveData = require('./liveData');
const eventData = require('./eventData');

const providerKey = 'varzesh3';
const defaultSeasonDataCache = seasonDataCache.createSeasonDataCache();

function normalizeKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getCompetitionMapping(competitionKey) {
  const mapping = competitionMap[normalizeKey(competitionKey)];
  return mapping ? structuredClone(mapping) : null;
}

function getSeasonMapping(competitionKey, seasonKey) {
  const competition = competitionMap[normalizeKey(competitionKey)];
  const season = competition?.seasons[normalizeKey(seasonKey)];
  return season ? structuredClone(season) : null;
}

function getSeasonMatches(leagueId, seasonId) {
  return defaultSeasonDataCache.getMatches(
    providerKey,
    leagueId,
    seasonId,
    (resolvedLeagueId, resolvedSeasonId) =>
      module.exports.fetchSeasonMatches(resolvedLeagueId, resolvedSeasonId)
  );
}

function getSeasonStandings(leagueId, seasonId) {
  return defaultSeasonDataCache.getStandings(
    providerKey,
    leagueId,
    seasonId,
    (resolvedLeagueId, resolvedSeasonId) =>
      module.exports.fetchSeasonStandings(resolvedLeagueId, resolvedSeasonId)
  );
}

module.exports = {
  providerKey,
  clearSeasonDataCache: defaultSeasonDataCache.clear,
  getCompetitionMapping,
  getSeasonMatches,
  getSeasonMapping,
  getSeasonStandings,
  ...eventData,
  ...liveData,
  ...seasonData,
  ...seasonDataCache,
  ...normalizers
};
