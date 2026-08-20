'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createServerLifecycle } = require('../src/serverLifecycle');
const { startProductionServer } = require('../src/server');

function captureLogger() {
  const records = [];
  return {
    records,
    info(event, fields = {}) {
      records.push({ level: 'info', event, fields });
    },
    error(event, fields = {}) {
      records.push({ level: 'error', event, fields });
    }
  };
}

function fakeProcess(env = {}) {
  const processRef = new EventEmitter();
  processRef.env = env;
  processRef.exitCode = undefined;
  return processRef;
}

function fakeListeningApp(options = {}) {
  const calls = [];
  const server = new EventEmitter();
  let closeCallback = null;
  server.closeCalls = 0;
  server.forceCloseCalls = 0;
  server.close = (callback) => {
    server.closeCalls += 1;
    closeCallback = callback;
    if (options.closeImmediately !== false) {
      queueMicrotask(() => callback());
    }
  };
  server.closeAllConnections = () => {
    server.forceCloseCalls += 1;
    if (closeCallback) {
      queueMicrotask(() => closeCallback());
    }
  };

  return {
    calls,
    server,
    listen(port, host) {
      calls.push({ port, host });
      queueMicrotask(() => {
        if (options.listenError) {
          server.emit('error', options.listenError);
        } else {
          server.emit('listening');
        }
      });
      return server;
    }
  };
}

function lifecycleOptions(overrides = {}) {
  return {
    app: fakeListeningApp(),
    config: {
      host: '127.0.0.1',
      port: 43210,
      shutdownTimeoutMs: 10000
    },
    logger: captureLogger(),
    processRef: fakeProcess(),
    ...overrides
  };
}

test('server listens on the configured host and port', async () => {
  const options = lifecycleOptions();
  const lifecycle = createServerLifecycle(options);

  assert.equal(await lifecycle.start(), options.app.server);
  assert.deepEqual(options.app.calls, [{ port: 43210, host: '127.0.0.1' }]);
  assert.equal(lifecycle.started, true);
  await lifecycle.shutdown('test');
});

test('SIGTERM-style shutdown closes normally with a successful exit status', async () => {
  const options = lifecycleOptions();
  const lifecycle = createServerLifecycle(options);
  lifecycle.registerProcessHandlers();
  await lifecycle.start();

  options.processRef.emit('SIGTERM');
  await lifecycle.shutdown('SIGTERM');

  assert.equal(options.app.server.closeCalls, 1);
  assert.equal(options.processRef.exitCode, 0);
  assert.equal(
    options.logger.records.filter((record) => record.event === 'shutdown_started')
      .length,
    1
  );
  assert.equal(options.processRef.listenerCount('SIGTERM'), 0);
});

test('shutdown is idempotent', async () => {
  const options = lifecycleOptions();
  const lifecycle = createServerLifecycle(options);
  await lifecycle.start();

  const first = lifecycle.shutdown('SIGINT');
  const second = lifecycle.shutdown('SIGTERM');
  assert.equal(first, second);
  await first;
  assert.equal(options.app.server.closeCalls, 1);
});

test('forced shutdown closes remaining connections and uses nonzero status', async () => {
  let forceTimeout;
  let timerCleared = false;
  const options = lifecycleOptions({
    app: fakeListeningApp({ closeImmediately: false }),
    setTimeoutFn(callback) {
      forceTimeout = callback;
      return { unref() {} };
    },
    clearTimeoutFn() {
      timerCleared = true;
    }
  });
  const lifecycle = createServerLifecycle(options);
  await lifecycle.start();

  const closing = lifecycle.shutdown('SIGTERM');
  forceTimeout();
  await closing;

  assert.equal(options.app.server.forceCloseCalls, 1);
  assert.equal(options.processRef.exitCode, 1);
  assert.equal(timerCleared, false);
  assert.equal(
    options.logger.records.some((record) => record.event === 'shutdown_forced'),
    true
  );
});

test('listen errors are safe and remove registered process handlers', async () => {
  const error = new Error('secret bind detail');
  error.code = 'EADDRINUSE';
  error.stack = 'STACK MUST NOT APPEAR';
  const options = lifecycleOptions({ app: fakeListeningApp({ listenError: error }) });
  const lifecycle = createServerLifecycle(options);
  lifecycle.registerProcessHandlers();

  assert.equal(await lifecycle.start(), null);
  assert.equal(options.processRef.exitCode, 1);
  assert.equal(options.processRef.listenerCount('SIGINT'), 0);
  assert.deepEqual(
    options.logger.records.find((record) => record.event === 'listen_failure'),
    {
      level: 'error',
      event: 'listen_failure',
      fields: { error_name: 'EADDRINUSE' }
    }
  );
  assert.equal(JSON.stringify(options.logger.records).includes('secret'), false);
  assert.equal(JSON.stringify(options.logger.records).includes('STACK'), false);
});

test('unexpected process errors trigger a nonzero graceful shutdown', async () => {
  const options = lifecycleOptions();
  const lifecycle = createServerLifecycle(options);
  await lifecycle.start();

  const error = new Error('token=do-not-log');
  error.stack = 'STACK MUST NOT APPEAR';
  await lifecycle.handleUnexpectedError(error, 'uncaughtException');

  assert.equal(options.processRef.exitCode, 1);
  assert.equal(options.app.server.closeCalls, 1);
  const serialized = JSON.stringify(options.logger.records);
  assert.equal(serialized.includes('do-not-log'), false);
  assert.equal(serialized.includes('STACK'), false);
});

test('invalid startup configuration prevents listen and exits nonzero', async () => {
  let appLoaded = false;
  const logger = captureLogger();
  const processRef = fakeProcess({ PORT: '1.5' });

  const result = await startProductionServer({
    appLoader() {
      appLoaded = true;
      return fakeListeningApp();
    },
    logger,
    processRef,
    loadEnvironment: false
  });

  assert.equal(result, null);
  assert.equal(appLoaded, false);
  assert.equal(processRef.exitCode, 1);
  assert.deepEqual(logger.records[0], {
    level: 'error',
    event: 'configuration_error',
    fields: { setting: 'PORT', error_name: 'RuntimeConfigError' }
  });
});

test('an injected app avoids loading the default app', async () => {
  const app = fakeListeningApp();
  const logger = captureLogger();
  const processRef = fakeProcess({
    HOST: '127.0.0.1',
    PORT: '43210',
    SHUTDOWN_TIMEOUT_MS: '10000'
  });
  let defaultAppLoaded = false;

  const lifecycle = await startProductionServer({
    app,
    appLoader() {
      defaultAppLoaded = true;
      throw new Error('default app must not load');
    },
    logger,
    processRef,
    loadEnvironment: false
  });

  assert.equal(defaultAppLoaded, false);
  assert.deepEqual(app.calls, [{ port: 43210, host: '127.0.0.1' }]);
  await lifecycle.shutdown('test');
});

test('app loader failures return null safely without process handlers', async () => {
  const logger = captureLogger();
  const processRef = fakeProcess({
    HOST: '127.0.0.1',
    PORT: '43210',
    SHUTDOWN_TIMEOUT_MS: '10000'
  });
  const error = new Error('token=must-not-log');
  error.name = 'AppBootstrapError';
  error.stack = 'STACK MUST NOT APPEAR';

  const result = await startProductionServer({
    appLoader() {
      throw error;
    },
    logger,
    processRef,
    loadEnvironment: false
  });

  assert.equal(result, null);
  assert.equal(processRef.exitCode, 1);
  assert.deepEqual(logger.records, [
    {
      level: 'error',
      event: 'startup_failure',
      fields: { error_name: 'AppBootstrapError' }
    }
  ]);
  assert.equal(processRef.listenerCount('SIGTERM'), 0);
  assert.equal(processRef.listenerCount('SIGINT'), 0);
  assert.equal(processRef.listenerCount('unhandledRejection'), 0);
  assert.equal(processRef.listenerCount('uncaughtException'), 0);
  assert.equal(JSON.stringify(logger.records).includes('must-not-log'), false);
  assert.equal(JSON.stringify(logger.records).includes('STACK'), false);
});

test('lifecycle creation failures return null safely', async () => {
  const logger = captureLogger();
  const processRef = fakeProcess({
    HOST: '127.0.0.1',
    PORT: '43210',
    SHUTDOWN_TIMEOUT_MS: '10000'
  });
  const error = new Error('private lifecycle detail');
  error.name = 'LifecycleCreationError';

  const result = await startProductionServer({
    app: fakeListeningApp(),
    lifecycleFactory() {
      throw error;
    },
    logger,
    processRef,
    loadEnvironment: false
  });

  assert.equal(result, null);
  assert.equal(processRef.exitCode, 1);
  assert.deepEqual(logger.records, [
    {
      level: 'error',
      event: 'startup_failure',
      fields: { error_name: 'LifecycleCreationError' }
    }
  ]);
  assert.equal(processRef.listenerCount('SIGTERM'), 0);
});

test('lifecycle startup failures clean up registered handlers', async () => {
  const logger = captureLogger();
  const processRef = fakeProcess({
    HOST: '127.0.0.1',
    PORT: '43210',
    SHUTDOWN_TIMEOUT_MS: '10000'
  });
  const signalHandler = () => {};
  let shutdownCalls = 0;
  let unregisterCalls = 0;

  const result = await startProductionServer({
    app: fakeListeningApp(),
    lifecycleFactory() {
      return {
        registerProcessHandlers() {
          processRef.on('SIGTERM', signalHandler);
        },
        async start() {
          const error = new Error('private startup detail');
          error.name = 'LifecycleStartError';
          throw error;
        },
        async shutdown() {
          shutdownCalls += 1;
        },
        unregisterProcessHandlers() {
          unregisterCalls += 1;
          processRef.removeListener('SIGTERM', signalHandler);
        }
      };
    },
    logger,
    processRef,
    loadEnvironment: false
  });

  assert.equal(result, null);
  assert.equal(processRef.exitCode, 1);
  assert.equal(shutdownCalls, 1);
  assert.equal(unregisterCalls, 1);
  assert.equal(processRef.listenerCount('SIGTERM'), 0);
  assert.equal(
    logger.records.some(
      (record) =>
        record.event === 'startup_failure' &&
        record.fields.error_name === 'LifecycleStartError'
    ),
    true
  );
  assert.equal(JSON.stringify(logger.records).includes('private startup'), false);
});
