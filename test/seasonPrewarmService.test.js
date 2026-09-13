'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  discoverActiveSeasonMatchScopes,
  prewarmActiveSeasonMatches
} = require('../src/services/seasonPrewarmService');
const { startProductionServer } = require('../src/server');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function captureLogger() {
  const records = [];
  return {
    records,
    info(event, fields = {}) {
      records.push({ level: 'info', event, fields });
    },
    warn(event, fields = {}) {
      records.push({ level: 'warn', event, fields });
    },
    error(event, fields = {}) {
      records.push({ level: 'error', event, fields });
    }
  };
}

function fakeDirectories(definitions) {
  return {
    competitionService: {
      getCompetitions() {
        return definitions.map((definition) => ({
          competition_key: definition.key,
          status: definition.status || 'active',
          is_active: definition.status !== 'archived'
        }));
      }
    },
    seasonService: {
      getSeasons(competitionKey) {
        const definition = definitions.find(
          (item) => item.key === competitionKey
        );
        return [{
          competition_key: competitionKey,
          season_key: definition.seasonKey,
          status: 'active'
        }];
      }
    }
  };
}

function fakeMappedProvider(definitions, getSeasonMatches = async () => ({})) {
  return {
    providerKey: 'varzesh3',
    getCompetitionMapping(competitionKey) {
      const definition = definitions.find(
        (item) => item.key === competitionKey
      );
      return definition ? { provider_league_id: definition.leagueId } : null;
    },
    getSeasonMapping(competitionKey, seasonKey) {
      const definition = definitions.find(
        (item) =>
          item.key === competitionKey && item.seasonKey === seasonKey
      );
      return definition ? { provider_season_id: definition.seasonId } : null;
    },
    getSeasonMatches
  };
}

test('configured active competition seasons are discovered from mappings', () => {
  const scopes = discoverActiveSeasonMatchScopes();
  const competitionKeys = scopes
    .flatMap((scope) => scope.competitionKeys)
    .sort();

  assert.deepEqual(competitionKeys, [
    'bundesliga',
    'champions_league',
    'europa_league',
    'la_liga',
    'ligue_1',
    'persian_gulf_pro_league',
    'premier_league',
    'serie_a'
  ]);
  assert.equal(scopes.length, 8);
  assert.equal(competitionKeys.includes('worldcup2026'), false);
});

test('duplicate provider scopes are deduplicated and archived scopes excluded', () => {
  const definitions = [
    { key: 'active_a', seasonKey: 'season', leagueId: 3, seasonId: 10 },
    { key: 'active_b', seasonKey: 'season', leagueId: 3, seasonId: 10 },
    {
      key: 'worldcup2026',
      seasonKey: '2026',
      leagueId: 99,
      seasonId: 99,
      status: 'archived'
    }
  ];
  const directories = fakeDirectories(definitions);
  const scopes = discoverActiveSeasonMatchScopes({
    ...directories,
    provider: fakeMappedProvider(definitions)
  });

  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes[0].competitionKeys, ['active_a', 'active_b']);
  assert.deepEqual(scopes[0].seasonKeys, ['season', 'season']);
  assert.equal(scopes[0].leagueId, 3);
  assert.equal(scopes[0].seasonId, 10);
});

test('prewarm uses cached season matches path and isolates scope failures', async () => {
  const definitions = [
    { key: 'active_a', seasonKey: 's1', leagueId: 1, seasonId: 11 },
    { key: 'active_b', seasonKey: 's2', leagueId: 2, seasonId: 22 },
    { key: 'active_c', seasonKey: 's3', leagueId: 3, seasonId: 33 }
  ];
  const calls = [];
  const provider = fakeMappedProvider(
    definitions,
    async (leagueId, seasonId) => {
      calls.push([leagueId, seasonId]);
      if (leagueId === 2) {
        throw new Error('private provider failure');
      }
      return { matches: [] };
    }
  );
  provider.fetchSeasonMatches = () => {
    assert.fail('prewarm bypassed getSeasonMatches cache path');
  };
  const logger = captureLogger();
  const summary = await prewarmActiveSeasonMatches({
    ...fakeDirectories(definitions),
    provider,
    logger,
    now: () => 100
  });

  assert.deepEqual(calls.sort(), [[1, 11], [2, 22], [3, 33]]);
  assert.deepEqual(summary, {
    scopeCount: 3,
    succeeded: 2,
    failed: 1,
    durationMs: 0
  });
  assert.equal(
    logger.records.some(
      (record) =>
        record.level === 'warn' &&
        record.event === 'season_matches_prewarm_scope_failed' &&
        record.fields.competition_key === 'active_b' &&
        record.fields.error_name === 'Error'
    ),
    true
  );
  assert.equal(
    logger.records.some(
      (record) =>
        record.event === 'season_matches_prewarm_scope_succeeded' &&
        record.fields.competition_key === 'active_c'
    ),
    true
  );
});

test('prewarm concurrency is bounded', async () => {
  const definitions = Array.from({ length: 6 }, (_, index) => ({
    key: `active_${index}`,
    seasonKey: `season_${index}`,
    leagueId: index + 1,
    seasonId: index + 101
  }));
  let active = 0;
  let maximumActive = 0;
  const provider = fakeMappedProvider(definitions, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return { matches: [] };
  });

  const summary = await prewarmActiveSeasonMatches({
    ...fakeDirectories(definitions),
    provider,
    logger: captureLogger(),
    concurrency: 2
  });

  assert.equal(maximumActive, 2);
  assert.equal(summary.succeeded, 6);
  assert.equal(summary.failed, 0);
});

test('server startup does not await the scheduled prewarm', async () => {
  const prewarmGate = deferred();
  const logger = captureLogger();
  const processRef = new EventEmitter();
  processRef.env = {
    HOST: '127.0.0.1',
    PORT: '43210',
    SHUTDOWN_TIMEOUT_MS: '10000'
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
  let prewarmStarted = false;

  const lifecycle = await startProductionServer({
    app,
    logger,
    processRef,
    loadEnvironment: false,
    schedulePrewarm(callback) {
      callback();
    },
    async prewarmSeasonMatches() {
      prewarmStarted = true;
      return prewarmGate.promise;
    }
  });

  assert.notEqual(lifecycle, null);
  assert.equal(lifecycle.started, true);
  assert.equal(prewarmStarted, true);

  prewarmGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await lifecycle.shutdown('test');
});
