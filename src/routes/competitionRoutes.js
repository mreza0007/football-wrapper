'use strict';

const express = require('express');
const competitionService = require('../services/competitionService');
const seasonService = require('../services/seasonService');
const competitionOverviewService = require(
  '../services/competitionOverviewService'
);
const competitionDataService = require('../services/competitionDataService');

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

router.get('/:competitionKey/seasons/:seasonKey/matches', async (req, res) => {
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

  const status =
    req.query.status === undefined
      ? 'all'
      : typeof req.query.status === 'string'
        ? req.query.status.trim().toLowerCase()
        : null;
  if (!['all', 'upcoming', 'live', 'finished'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'Invalid status' });
  }

  const result = await competitionDataService.getMatches(
    competition.competition_key,
    season.season_key,
    status
  );

  return res.json({
    ok: true,
    competition_key: competition.competition_key,
    season_key: season.season_key,
    count: result.matches.length,
    matches: result.matches,
    warnings: result.warnings
  });
});

router.get('/:competitionKey/seasons/:seasonKey/overview', async (req, res) => {
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

  const result = await competitionOverviewService.getOverview(
    competition.competition_key,
    season.season_key
  );
  return res.json({
    ok: true,
    competition_key: competition.competition_key,
    season_key: season.season_key,
    count: result.matches.length,
    stale: result.stale,
    warnings: result.warnings,
    matches: result.matches
  });
});

router.get('/:competitionKey/seasons/:seasonKey/standings', async (req, res) => {
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

  if (season.capabilities?.supports_standings !== true) {
    return res.status(501).json({ ok: false, error: 'Standings not supported' });
  }

  const standings = await competitionDataService.getStandings(
    competition.competition_key,
    season.season_key
  );

  return res.json({
    ok: true,
    competition_key: competition.competition_key,
    season_key: season.season_key,
    count: standings.length,
    standings
  });
});

router.get('/:competitionKey/seasons/:seasonKey/teams', async (req, res) => {
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

  const result = await competitionDataService.getTeams(
    competition.competition_key,
    season.season_key
  );

  return res.json({
    ok: true,
    competition_key: competition.competition_key,
    season_key: season.season_key,
    count: result.teams.length,
    teams: result.teams,
    warnings: result.warnings
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
