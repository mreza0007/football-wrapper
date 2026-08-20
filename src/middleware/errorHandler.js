'use strict';

const { logger: defaultLogger, safeErrorName } = require('../utils/logger');

function createErrorHandler(logger = defaultLogger) {
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      return next(err);
    }

    const status = Number.isInteger(err.status) ? err.status : 500;
    const message =
      err.publicMessage || (status >= 500 ? 'Internal server error' : err.message);

    if (status >= 500) {
      logger.error('http_server_error', {
        status,
        method: req.method,
        path: req.path,
        error_name: safeErrorName(err)
      });
    }

    return res.status(status).json({ ok: false, error: message });
  };
}

const errorHandler = createErrorHandler();

module.exports = errorHandler;
module.exports.createErrorHandler = createErrorHandler;
