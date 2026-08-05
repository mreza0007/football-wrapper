'use strict';

const { competitions } = require('../config/competitionRegistry');

function normalizeKey(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function copy(value) {
  return structuredClone(value);
}

function getCompetitions() {
  return copy(competitions);
}

function getCompetition(competitionKey) {
  const normalizedKey = normalizeKey(competitionKey);
  const competition = competitions.find(
    (item) => item.competition_key === normalizedKey
  );

  return competition ? copy(competition) : null;
}

module.exports = { getCompetitions, getCompetition, normalizeKey };
