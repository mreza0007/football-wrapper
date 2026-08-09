'use strict';

const { logger: defaultLogger, safeErrorName } = require('./utils/logger');

function createServerLifecycle(options) {
  const {
    app,
    config,
    logger = defaultLogger,
    processRef = process,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = options;

  let server = null;
  let startPromise = null;
  let shutdownPromise = null;
  let shutdownResolve = null;
  let forceTimer = null;
  let started = false;
  let handlersRegistered = false;
  let requestedExitCode = 0;

  function setExitCode(code) {
    requestedExitCode = Math.max(requestedExitCode, code);
    processRef.exitCode = requestedExitCode;
  }

  function unregisterProcessHandlers() {
    if (!handlersRegistered) {
      return;
    }
    processRef.removeListener('SIGTERM', handleSigterm);
    processRef.removeListener('SIGINT', handleSigint);
    processRef.removeListener('unhandledRejection', handleUnhandledRejection);
    processRef.removeListener('uncaughtException', handleUncaughtException);
    handlersRegistered = false;
  }

  function finishShutdown(closeError) {
    if (forceTimer) {
      clearTimeoutFn(forceTimer);
      forceTimer = null;
    }
    if (closeError) {
      setExitCode(1);
      logger.error('shutdown_close_failure', {
        error_name: safeErrorName(closeError)
      });
    }
    setExitCode(requestedExitCode);
    logger.info('shutdown_completed', { status: requestedExitCode });
    unregisterProcessHandlers();
    shutdownResolve?.();
    shutdownResolve = null;
  }

  function shutdown(signal = 'shutdown', exitCode = 0) {
    setExitCode(exitCode);
    if (shutdownPromise) {
      return shutdownPromise;
    }

    logger.info('shutdown_started', { signal });
    shutdownPromise = new Promise((resolve) => {
      shutdownResolve = resolve;
    });

    if (!server) {
      finishShutdown();
      return shutdownPromise;
    }

    forceTimer = setTimeoutFn(() => {
      forceTimer = null;
      setExitCode(1);
      logger.error('shutdown_forced', {
        timeout_ms: config.shutdownTimeoutMs
      });
      try {
        server.closeAllConnections?.();
      } catch (error) {
        logger.error('shutdown_close_failure', {
          error_name: safeErrorName(error)
        });
      }
    }, config.shutdownTimeoutMs);
    forceTimer.unref?.();

    try {
      server.close((error) => finishShutdown(error));
    } catch (error) {
      finishShutdown(error);
    }
    return shutdownPromise;
  }

  function handleUnexpectedError(error, source) {
    logger.error('unexpected_process_error', {
      source,
      error_name: safeErrorName(error)
    });
    return shutdown(source, 1);
  }

  function handleSigterm() {
    void shutdown('SIGTERM', 0);
  }

  function handleSigint() {
    void shutdown('SIGINT', 0);
  }

  function handleUnhandledRejection(reason) {
    void handleUnexpectedError(reason, 'unhandledRejection');
  }

  function handleUncaughtException(error) {
    void handleUnexpectedError(error, 'uncaughtException');
  }

  function registerProcessHandlers() {
    if (handlersRegistered) {
      return;
    }
    processRef.on('SIGTERM', handleSigterm);
    processRef.on('SIGINT', handleSigint);
    processRef.on('unhandledRejection', handleUnhandledRejection);
    processRef.on('uncaughtException', handleUncaughtException);
    handlersRegistered = true;
  }

  function listenFailure(error) {
    setExitCode(1);
    logger.error('listen_failure', { error_name: safeErrorName(error) });
    unregisterProcessHandlers();
  }

  function start() {
    if (startPromise) {
      return startPromise;
    }

    startPromise = new Promise((resolve) => {
      function onListenError(error) {
        listenFailure(error);
        resolve(null);
      }

      try {
        server = app.listen(config.port, config.host);
        server.once('error', onListenError);
        server.once('listening', () => {
          server.removeListener('error', onListenError);
          server.on('error', (error) => {
            void handleUnexpectedError(error, 'serverError');
          });
          started = true;
          logger.info('server_started', {
            host: config.host,
            port: config.port
          });
          resolve(server);
        });
      } catch (error) {
        listenFailure(error);
        resolve(null);
      }
    });

    return startPromise;
  }

  return {
    get server() {
      return server;
    },
    get started() {
      return started;
    },
    handleUnexpectedError,
    registerProcessHandlers,
    shutdown,
    start,
    unregisterProcessHandlers
  };
}

module.exports = { createServerLifecycle };
