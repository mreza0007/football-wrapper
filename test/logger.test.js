'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createErrorHandler } = require('../src/middleware/errorHandler');
const { createLogger } = require('../src/utils/logger');

function writableCapture() {
  let output = '';
  return {
    stream: {
      write(value) {
        output += value;
      }
    },
    output() {
      return output;
    }
  };
}

test('logger emits allowlisted lifecycle fields without secret-like details', () => {
  const stdout = writableCapture();
  const stderr = writableCapture();
  const logger = createLogger({
    stdout: stdout.stream,
    stderr: stderr.stream,
    now: () => new Date('2026-01-02T03:04:05.000Z')
  });

  logger.error('unexpected_process_error', {
    source: 'uncaughtException',
    error_name: 'TypeError',
    stack: 'STACK MUST NOT APPEAR',
    token: 'secret-token',
    provider_url: 'https://provider.invalid/private'
  });

  const output = stderr.output();
  assert.match(output, /2026-01-02T03:04:05\.000Z/);
  assert.match(output, /event=unexpected_process_error/);
  assert.match(output, /error_name="TypeError"/);
  assert.equal(output.includes('STACK'), false);
  assert.equal(output.includes('secret-token'), false);
  assert.equal(output.includes('provider.invalid'), false);
  assert.equal(stdout.output(), '');

  logger.error('unexpected_process_error', {
    error_name: 'https://provider.invalid/token=secret'
  });
  assert.equal(stderr.output().includes('provider.invalid'), false);
  assert.equal(stderr.output().includes('token=secret'), false);
});

test('expected provider 502 errors are logged safely without changing response', async () => {
  const stderr = writableCapture();
  const logger = createLogger({
    stdout: writableCapture().stream,
    stderr: stderr.stream,
    now: () => new Date('2026-01-02T03:04:05.000Z')
  });
  const testApp = express();
  testApp.get('/provider', (req, res, next) => {
    const error = new Error(
      'https://provider.invalid/private token=secret response payload'
    );
    error.name = 'PublicApiError';
    error.status = 502;
    error.publicMessage = 'Provider unavailable';
    next(error);
  });
  testApp.use(createErrorHandler(logger));

  const response = await request(testApp).get('/provider').expect(502);

  assert.deepEqual(response.body, { ok: false, error: 'Provider unavailable' });
  const output = stderr.output();
  assert.match(output, /event=http_server_error/);
  assert.match(output, /status="502"/);
  assert.match(output, /method="GET"/);
  assert.match(output, /path="\/provider"/);
  assert.match(output, /error_name="PublicApiError"/);
  assert.equal(output.includes('provider.invalid'), false);
  assert.equal(output.includes('secret'), false);
  assert.equal(output.includes('payload'), false);
  assert.equal(output.includes('Error:'), false);
});

test('unexpected 500 responses retain the central public error shape', async () => {
  const logger = createLogger({
    stdout: writableCapture().stream,
    stderr: writableCapture().stream
  });
  const testApp = express();
  testApp.get('/unexpected', () => {
    throw new TypeError('internal detail');
  });
  testApp.use(createErrorHandler(logger));

  const response = await request(testApp).get('/unexpected').expect(500);
  assert.deepEqual(response.body, { ok: false, error: 'Internal server error' });
});

test('importing app.js does not start an HTTP listener', () => {
  const expressModule = require('express');
  const originalListen = expressModule.application.listen;
  let listenCalls = 0;
  expressModule.application.listen = function interceptedListen() {
    listenCalls += 1;
    return originalListen.apply(this, arguments);
  };

  try {
    delete require.cache[require.resolve('../src/app')];
    const importedApp = require('../src/app');
    assert.equal(typeof importedApp, 'function');
    assert.equal(listenCalls, 0);
  } finally {
    expressModule.application.listen = originalListen;
  }
});
