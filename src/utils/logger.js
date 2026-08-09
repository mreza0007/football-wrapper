'use strict';

const SAFE_FIELD_NAMES = new Set([
  'error_name',
  'host',
  'method',
  'path',
  'port',
  'setting',
  'signal',
  'source',
  'status',
  'timeout_ms'
]);

function safeToken(value, fallback = 'unknown') {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback;
  }
  const normalized = String(value)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return normalized || fallback;
}

function safeIdentifier(value, fallback = 'Error') {
  const candidate = safeToken(value, fallback);
  return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate)
    ? candidate
    : fallback;
}

function safeErrorName(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
    return 'NonErrorRejection';
  }
  return safeIdentifier(error.code || error.name || 'Error');
}

function createLogger(options = {}) {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const now = options.now || (() => new Date());

  function write(level, event, fields = {}) {
    const parts = [
      safeToken(now().toISOString()),
      `level=${level}`,
      `event=${safeToken(event)}`
    ];

    for (const [name, value] of Object.entries(fields)) {
      if (!SAFE_FIELD_NAMES.has(name) || value === undefined || value === null) {
        continue;
      }
      const safeValue =
        name === 'error_name' ? safeIdentifier(value) : safeToken(value);
      parts.push(`${name}=${JSON.stringify(safeValue)}`);
    }

    const destination = level === 'INFO' ? stdout : stderr;
    destination.write(`${parts.join(' ')}\n`);
  }

  return {
    info(event, fields) {
      write('INFO', event, fields);
    },
    error(event, fields) {
      write('ERROR', event, fields);
    }
  };
}

const logger = createLogger();

module.exports = { createLogger, logger, safeErrorName, safeToken };
