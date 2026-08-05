'use strict';

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const status = Number.isInteger(err.status) ? err.status : 500;
  const message =
    err.publicMessage || (status >= 500 ? 'Internal server error' : err.message);

  return res.status(status).json({ ok: false, error: message });
}

module.exports = errorHandler;
