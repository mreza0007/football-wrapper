'use strict';

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'generic-football-wrapper',
    version: '0.1.0'
  });
});

module.exports = router;
