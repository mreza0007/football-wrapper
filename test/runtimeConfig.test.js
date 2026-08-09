'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  RuntimeConfigError,
  parseRuntimeConfig
} = require('../src/config/runtimeConfig');

test('runtime configuration uses safe production defaults', () => {
  assert.deepEqual(parseRuntimeConfig({}), {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    shutdownTimeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS
  });
  assert.equal(DEFAULT_HOST, '127.0.0.1');
  assert.equal(DEFAULT_PORT, 3060);
  assert.equal(DEFAULT_SHUTDOWN_TIMEOUT_MS, 10000);
});

test('runtime configuration accepts valid HOST, PORT, and shutdown timeout', () => {
  assert.deepEqual(
    parseRuntimeConfig({
      HOST: ' 0.0.0.0 ',
      PORT: '65535',
      SHUTDOWN_TIMEOUT_MS: '2500'
    }),
    { host: '0.0.0.0', port: 65535, shutdownTimeoutMs: 2500 }
  );
});

test('invalid PORT values are rejected', () => {
  for (const value of ['', ' ', '1.5', '-1', '0', 'NaN', '65536', ' 3060 ']) {
    assert.throws(
      () => parseRuntimeConfig({ PORT: value }),
      (error) =>
        error instanceof RuntimeConfigError && error.setting === 'PORT',
      `PORT=${JSON.stringify(value)}`
    );
  }
});

test('empty HOST values are rejected', () => {
  for (const value of ['', ' ', '\t\r\n']) {
    assert.throws(
      () => parseRuntimeConfig({ HOST: value }),
      (error) =>
        error instanceof RuntimeConfigError && error.setting === 'HOST'
    );
  }
});

test('invalid shutdown timeout values are rejected', () => {
  for (const value of ['', '0', '-1', '1.5', 'NaN', '9007199254740992']) {
    assert.throws(
      () => parseRuntimeConfig({ SHUTDOWN_TIMEOUT_MS: value }),
      (error) =>
        error instanceof RuntimeConfigError &&
        error.setting === 'SHUTDOWN_TIMEOUT_MS',
      `SHUTDOWN_TIMEOUT_MS=${JSON.stringify(value)}`
    );
  }
});
