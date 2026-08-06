'use strict';

const express = require('express');
const liveMatchService = require('../services/liveMatchService');
const matchEventService = require('../services/matchEventService');

const router = express.Router();

router.get('/:matchId/live', async (req, res) => {
  const result = await liveMatchService.getLiveMatch(req.params.matchId);
  return res.json({ ok: true, match: result.match });
});

router.get('/:matchId/events', async (req, res) => {
  const result = await matchEventService.getMatchEvents(req.params.matchId);
  const { locator } = result;
  return res.json({
    ok: true,
    match_id: locator.snapshot.id,
    competition_key: locator.snapshot.competition_key,
    season_key: locator.snapshot.season_key,
    provider: locator.snapshot.provider,
    external_match_id: locator.external_match_id,
    count: result.events.length,
    events: result.events,
    stale: result.stale,
    warnings: result.warnings
  });
});

module.exports = router;
