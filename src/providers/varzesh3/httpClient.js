'use strict';

const DEFAULT_BASE_URL = 'https://web-api.varzesh3.com/v2.0';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 2;

class ProviderRequestError extends Error {
  constructor(kind, status = null) {
    super('Varzesh3 request failed');
    this.name = 'ProviderRequestError';
    this.kind = kind;
    this.status = status;
  }
}

function getConfig() {
  const baseUrl = (process.env.VARZESH3_BASE_URL || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ''
  );
  const configuredTimeout = Number.parseInt(process.env.VARZESH3_TIMEOUT_MS, 10);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;

  return { baseUrl, timeoutMs };
}

function isTimeout(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError';
}

async function requestJson(url, options = {}) {
  const { timeoutMs } = getConfig();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;

    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      if (attempt < retries && isTimeout(error)) {
        continue;
      }
      throw new ProviderRequestError(isTimeout(error) ? 'timeout' : 'network');
    }

    if (response.status >= 500) {
      if (attempt < retries) {
        continue;
      }
      throw new ProviderRequestError('server', response.status);
    }

    if (!response.ok) {
      throw new ProviderRequestError('http', response.status);
    }

    const contentType = response.headers?.get?.('content-type') || '';
    if (!contentType.toLowerCase().includes('json')) {
      throw new ProviderRequestError('invalid_json', response.status);
    }

    try {
      return await response.json();
    } catch {
      throw new ProviderRequestError('invalid_json', response.status);
    }
  }

  throw new ProviderRequestError('network');
}

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  ProviderRequestError,
  getConfig,
  requestJson
};
