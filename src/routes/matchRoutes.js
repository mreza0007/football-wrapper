'use strict';

const express = require('express');
const liveMatchService = require('../services/liveMatchService');

const router = express.Router();

router.get('/:matchId/live', async (req, res) => {
  const result = await liveMatchService.getLiveMatch(req.params.matchId);
  return res.json({ ok: true, match: result.match });
});

module.exports = router;
