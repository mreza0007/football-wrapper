'use strict';

const express = require('express');
const competitionService = require('../services/competitionService');
const seasonService = require('../services/seasonService');

const router = express.Router();

function sendCompetitionNotFound(res) {
  return res.status(404).json({ ok: false, error: 'Competition not found' });
}

router.get('/', (req, res) => {
  const competitions = competitionService.getCompetitions();
  res.json({ ok: true, count: competitions.length, competitions });
});

router.get('/:competitionKey', (req, res) => {
  const competition = competitionService.getCompetition(
    req.params.competitionKey
  );

  if (!competition) {
    return sendCompetitionNotFound(res);
  }

  return res.json(competition);
});

router.get('/:competitionKey/seasons', (req, res) => {
  const competition = competitionService.getCompetition(
    req.params.competitionKey
  );

  if (!competition) {
    return sendCompetitionNotFound(res);
  }

  const seasons = seasonService.getSeasons(competition.competition_key);
  return res.json({
    ok: true,
    competition_key: competition.competition_key,
    count: seasons.length,
    seasons
  });
});

router.get('/:competitionKey/seasons/:seasonKey', (req, res) => {
  const competition = competitionService.getCompetition(
    req.params.competitionKey
  );

  if (!competition) {
    return sendCompetitionNotFound(res);
  }

  const season = seasonService.getSeason(
    competition.competition_key,
    req.params.seasonKey
  );

  if (!season) {
    return res.status(404).json({ ok: false, error: 'Season not found' });
  }

  return res.json(season);
});

module.exports = router;
