'use strict';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3060;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10000;

class RuntimeConfigError extends Error {
  constructor(setting) {
    super(`Invalid ${setting} configuration`);
    this.name = 'RuntimeConfigError';
    this.setting = setting;
  }
}

function decimalInteger(value, setting, fallback, maximum) {
  const candidate = value === undefined ? String(fallback) : value;
  if (typeof candidate !== 'string' || !/^\d+$/.test(candidate)) {
    throw new RuntimeConfigError(setting);
  }

  const parsed = Number(candidate);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new RuntimeConfigError(setting);
  }
  return parsed;
}

function parseRuntimeConfig(env = process.env) {
  const configuredHost = env.HOST === undefined ? DEFAULT_HOST : env.HOST;
  if (typeof configuredHost !== 'string' || configuredHost.trim() === '') {
    throw new RuntimeConfigError('HOST');
  }

  return {
    host: configuredHost.trim(),
    port: decimalInteger(env.PORT, 'PORT', DEFAULT_PORT, 65535),
    shutdownTimeoutMs: decimalInteger(
      env.SHUTDOWN_TIMEOUT_MS,
      'SHUTDOWN_TIMEOUT_MS',
      DEFAULT_SHUTDOWN_TIMEOUT_MS,
      Number.MAX_SAFE_INTEGER
    )
  };
}

module.exports = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  RuntimeConfigError,
  parseRuntimeConfig
};
