'use strict';

const { seasons } = require('../config/competitionRegistry');
const { normalizeKey } = require('./competitionService');

function copy(value) {
  return structuredClone(value);
}

function getSeasons(competitionKey) {
  const normalizedCompetitionKey = normalizeKey(competitionKey);

  return copy(
    seasons.filter(
      (season) => season.competition_key === normalizedCompetitionKey
    )
  );
}

function getSeason(competitionKey, seasonKey) {
  const normalizedCompetitionKey = normalizeKey(competitionKey);
  const normalizedSeasonKey = normalizeKey(seasonKey);
  const season = seasons.find(
    (item) =>
      item.competition_key === normalizedCompetitionKey &&
      item.season_key === normalizedSeasonKey
  );

  return season ? copy(season) : null;
}

module.exports = { getSeasons, getSeason };
