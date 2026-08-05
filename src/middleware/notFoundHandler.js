'use strict';

function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, error: 'Route not found' });
}

module.exports = notFoundHandler;
