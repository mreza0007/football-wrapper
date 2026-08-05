'use strict';

const competitionMap = require('./competitionMap');

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

module.exports = {
  providerKey: 'varzesh3',
  getCompetitionMapping,
  getSeasonMapping
};
