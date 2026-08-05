'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ProviderRequestError,
  requestJson
} = require('../src/providers/varzesh3/httpClient');

function response(body, status = 200, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    json: async () => body
  };
}

test('HTTP client retries 5xx responses within its bound', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls < 3 ? response({}, 503) : response({ ok: true });
  };

  const body = await requestJson('https://example.test/data', { fetchImpl });
  assert.deepEqual(body, { ok: true });
  assert.equal(calls, 3);
});

test('HTTP client does not retry ordinary 4xx responses', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response({}, 400);
  };

  await assert.rejects(
    requestJson('https://example.test/data', { fetchImpl }),
    (error) =>
      error instanceof ProviderRequestError &&
      error.kind === 'http' &&
      error.status === 400
  );
  assert.equal(calls, 1);
});

test('HTTP client rejects non-JSON responses without retrying', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response('not json', 200, 'text/plain');
  };

  await assert.rejects(
    requestJson('https://example.test/data', { fetchImpl }),
    (error) =>
      error instanceof ProviderRequestError && error.kind === 'invalid_json'
  );
  assert.equal(calls, 1);
});
