'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_BASE_URL,
  getConfig,
  ProviderRequestError,
  requestJson
} = require('../src/providers/varzesh3/httpClient');

function setBaseUrl(t, value) {
  const previous = process.env.VARZESH3_BASE_URL;
  t.after(() => {
    if (previous === undefined) delete process.env.VARZESH3_BASE_URL;
    else process.env.VARZESH3_BASE_URL = previous;
  });
  if (value === undefined) delete process.env.VARZESH3_BASE_URL;
  else process.env.VARZESH3_BASE_URL = value;
}

test('HTTP client defaults to the Varzesh3 .ir API when no override is set', (t) => {
  setBaseUrl(t, undefined);
  assert.equal(DEFAULT_BASE_URL, 'https://web-api.varzesh3.ir/v2.0');
  assert.equal(getConfig().baseUrl, DEFAULT_BASE_URL);
});

test('HTTP client preserves the environment override and removes trailing slashes', (t) => {
  setBaseUrl(t, 'https://custom.example/v2.0///');
  assert.equal(getConfig().baseUrl, 'https://custom.example/v2.0');
});

test('HTTP client retains default fallback for an empty environment override', (t) => {
  setBaseUrl(t, '');
  assert.equal(getConfig().baseUrl, DEFAULT_BASE_URL);
});

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
