'use strict';

const { parseRuntimeConfig, RuntimeConfigError } = require('./config/runtimeConfig');
const { createServerLifecycle } = require('./serverLifecycle');
const { logger: defaultLogger, safeErrorName } = require('./utils/logger');

async function startProductionServer(options = {}) {
  const processRef = options.processRef || process;
  const logger = options.logger || defaultLogger;
  let lifecycle = null;

  try {
    if (options.loadEnvironment !== false) {
      require('dotenv').config({ quiet: true });
    }

    let config;
    try {
      config = parseRuntimeConfig(options.env || processRef.env);
    } catch (error) {
      if (!(error instanceof RuntimeConfigError)) {
        throw error;
      }
      processRef.exitCode = 1;
      logger.error('configuration_error', {
        setting: error.setting,
        error_name: safeErrorName(error)
      });
      return null;
    }

    const selectedApp =
      options.app ||
      (options.appLoader ? options.appLoader() : require('./app'));
    const lifecycleFactory = options.lifecycleFactory || createServerLifecycle;

    lifecycle = lifecycleFactory({
      app: selectedApp,
      config,
      logger,
      processRef,
      setTimeoutFn: options.setTimeoutFn,
      clearTimeoutFn: options.clearTimeoutFn
    });
    lifecycle.registerProcessHandlers();
    await lifecycle.start();
    return lifecycle;
  } catch (error) {
    processRef.exitCode = 1;
    logger.error('startup_failure', { error_name: safeErrorName(error) });

    if (lifecycle) {
      try {
        await lifecycle.shutdown('startupFailure', 1);
      } catch {
        // The original startup error is already logged safely.
      } finally {
        try {
          lifecycle.unregisterProcessHandlers();
        } catch {
          // Process exit status remains nonzero even if cleanup cannot complete.
        }
      }
    }
    return null;
  }
}

if (require.main === module) {
  void startProductionServer().catch((error) => {
    process.exitCode = 1;
    defaultLogger.error('startup_failure', {
      error_name: safeErrorName(error)
    });
  });
}

module.exports = { startProductionServer };
