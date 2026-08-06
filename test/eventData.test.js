'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ProviderRequestError } = require('../src/providers/varzesh3/httpClient');
const {
  EventsUnavailableError,
  createEventCache,
  fetchMatchEvents,
  flattenEvents
} = require('../src/providers/varzesh3/eventData');

test('event provider URL uses a validated resolved external match ID', async () => {
  let requestedUrl;
  const result = await fetchMatchEvents(475878, {
    requestJson: async (url) => {
      requestedUrl = url;
      return [];
    }
  });

  assert.match(requestedUrl, /\/matches\/475878\/events$/);
  assert.deepEqual(result, []);
});

test('invalid external match IDs are rejected before an HTTP request', async () => {
  let called = false;
  for (const value of ['', 0, -1, 'abc', '1/path', true, '1e2']) {
    await assert.rejects(
      fetchMatchEvents(value, {
        requestJson: async () => {
          called = true;
          return [];
        }
      }),
      TypeError
    );
  }
  assert.equal(called, false);
});

test('actual array root and wrapper roots flatten safely', () => {
  assert.deepEqual(flattenEvents([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(flattenEvents({ events: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(flattenEvents({ data: { events: [{ id: 3 }] } }), [
    { id: 3 }
  ]);
  assert.deepEqual(flattenEvents({ events: [] }), []);
});

test('duplicate provider event IDs are removed', () => {
  const result = flattenEvents([
    { id: 1, time: 10 },
    { id: '1', time: 11 },
    { id: 2, time: 10 }
  ]);
  assert.deepEqual(
    result.map((event) => event.id),
    [1, 2]
  );
});

test('exact duplicate ID-less events are removed without collapsing distinct same-minute events', () => {
  const first = { time: '23', eventType: 1, strickerName: 'بازیکن اول' };
  const result = flattenEvents([
    first,
    { strickerName: 'بازیکن اول', eventType: 1, time: '23' },
    { time: '23', eventType: 1, strickerName: 'بازیکن دوم' }
  ]);
  assert.equal(result.length, 2);
});

test('event endpoint 404 and 410 become events-unavailable errors', async () => {
  for (const status of [404, 410]) {
    await assert.rejects(
      fetchMatchEvents(101, {
        requestJson: async () => {
          throw new ProviderRequestError('http', status);
        }
      }),
      EventsUnavailableError
    );
  }
});

test('event cache shares one in-flight refresh for the same match', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const cache = createEventCache({
    fetchEvents: async (matchId) => {
      calls += 1;
      await gate;
      return [{ id: matchId }];
    }
  });

  const first = cache.get(101);
  const second = cache.get(101);
  release();
  const [left, right] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(left, right);
});

test('event cache isolates data by external match ID', async () => {
  const cache = createEventCache({
    fetchEvents: async (matchId) => [{ id: matchId }]
  });

  assert.equal((await cache.get(101)).events[0].id, 101);
  assert.equal((await cache.get(202)).events[0].id, 202);
  assert.deepEqual(cache.peek(101), [{ id: 101 }]);
  assert.deepEqual(cache.peek(202), [{ id: 202 }]);
});

test('event cache evicts the least-recently-used entry at its size bound', async () => {
  const cache = createEventCache({
    maxEntries: 2,
    fetchEvents: async (matchId) => [{ id: matchId }]
  });

  await cache.get(101);
  await cache.get(202);
  await cache.get(101);
  await cache.get(303);

  assert.equal(cache.size(), 2);
  assert.notEqual(cache.peek(101), null);
  assert.equal(cache.peek(202), null);
  assert.notEqual(cache.peek(303), null);
});

test('provider failure preserves expired cache data and returns it as stale', async () => {
  let currentTime = 0;
  let fail = false;
  const cache = createEventCache({
    now: () => currentTime,
    ttlMs: 10,
    fetchEvents: async () => {
      if (fail) {
        throw new ProviderRequestError('network');
      }
      return [{ id: 1 }];
    }
  });

  await cache.get(101);
  currentTime = 11;
  fail = true;
  const stale = await cache.get(101);

  assert.equal(stale.stale, true);
  assert.deepEqual(stale.events, [{ id: 1 }]);
  assert.deepEqual(cache.peek(101), [{ id: 1 }]);
});

test('clearing event cache prevents an older in-flight refresh from repopulating it', async () => {
  let calls = 0;
  const releases = [];
  const cache = createEventCache({
    fetchEvents: async () => {
      calls += 1;
      const call = calls;
      await new Promise((resolve) => {
        releases[call] = resolve;
      });
      return [{ id: call }];
    }
  });

  const oldRefresh = cache.get(101);
  cache.clear();
  const newRefresh = cache.get(101);
  releases[1]();
  releases[2]();
  await Promise.all([oldRefresh, newRefresh]);

  assert.deepEqual(cache.peek(101), [{ id: 2 }]);
});
