'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');

function runIsolated(script) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
}

test('requiring server.js alone does not load app.js', () => {
  const result = runIsolated(`
    const appPath = require.resolve('./src/app');
    require('./src/server');
    if (require.cache[appPath]) {
      process.stderr.write('app.js was loaded');
      process.exitCode = 1;
    }
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('environment loading occurs before the default app loader', () => {
  const result = runIsolated(`
    const { EventEmitter } = require('node:events');
    const dotenv = require('dotenv');
    const order = [];
    dotenv.config = () => {
      order.push('environment');
      return {};
    };

    const server = new EventEmitter();
    server.close = (callback) => queueMicrotask(() => callback());
    server.closeAllConnections = () => {};
    const app = {
      listen() {
        queueMicrotask(() => server.emit('listening'));
        return server;
      }
    };
    const processRef = new EventEmitter();
    processRef.env = {
      HOST: '127.0.0.1',
      PORT: '43210',
      SHUTDOWN_TIMEOUT_MS: '10000'
    };
    const logger = { info() {}, error() {} };
    const { startProductionServer } = require('./src/server');

    (async () => {
      const lifecycle = await startProductionServer({
        appLoader() {
          order.push('app');
          return app;
        },
        logger,
        processRef
      });
      if (order.join(',') !== 'environment,app') {
        throw new Error('wrong startup order: ' + order.join(','));
      }
      await lifecycle.shutdown('test');
    })().catch((error) => {
      process.stderr.write(error.message);
      process.exitCode = 1;
    });
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});

test('dotenv failures return null safely before app loading', () => {
  const result = runIsolated(`
    const { EventEmitter } = require('node:events');
    const dotenv = require('dotenv');
    dotenv.config = () => {
      const error = new Error('token=must-not-log');
      error.name = 'DotenvLoadError';
      error.stack = 'STACK MUST NOT APPEAR';
      throw error;
    };

    const processRef = new EventEmitter();
    processRef.env = {
      HOST: '127.0.0.1',
      PORT: '43210',
      SHUTDOWN_TIMEOUT_MS: '10000'
    };
    const records = [];
    const logger = {
      info(event, fields = {}) { records.push({ level: 'info', event, fields }); },
      error(event, fields = {}) { records.push({ level: 'error', event, fields }); }
    };
    let appLoaded = false;
    const { startProductionServer } = require('./src/server');

    (async () => {
      const startup = startProductionServer({
        appLoader() {
          appLoaded = true;
          throw new Error('app must not load');
        },
        logger,
        processRef
      });
      let unhandled = false;
      process.once('unhandledRejection', () => { unhandled = true; });
      const result = await startup;
      await new Promise((resolve) => setImmediate(resolve));

      if (result !== null) throw new Error('startup did not return null');
      if (processRef.exitCode !== 1) throw new Error('exit code was not 1');
      if (appLoaded) throw new Error('app loader was invoked');
      if (unhandled) throw new Error('startup became an unhandled rejection');
      if (processRef.eventNames().length !== 0) {
        throw new Error('process handlers remained registered');
      }
      const serialized = JSON.stringify(records);
      if (!serialized.includes('startup_failure')) {
        throw new Error('startup failure was not logged');
      }
      if (!serialized.includes('DotenvLoadError')) {
        throw new Error('safe error name was not logged');
      }
      if (serialized.includes('must-not-log') || serialized.includes('STACK')) {
        throw new Error('sensitive error detail was logged');
      }
    })().catch((error) => {
      process.stderr.write(error.message);
      process.exitCode = 1;
    });
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
});
