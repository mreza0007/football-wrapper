'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchSeasonMatches,
  flattenMatches
} = require('../src/providers/varzesh3/seasonData');

const base = 'https://web-api.varzesh3.com/v2.0';
const seasonPath = '/football/leagues/3/seasons/902037';

function page(ids, links = []) {
  return {
    _links: links,
    items: [
      {
        round: 1,
        dates: [
          {
            date: '۱۴۰۵/۰۵/۱۰',
            matches: ids.map((id) => ({ id }))
          }
        ]
      }
    ]
  };
}

test('nested items dates and matches are flattened', () => {
  const result = flattenMatches(page([1, 2]));

  assert.deepEqual(
    result.map((entry) => entry.match.id),
    [1, 2]
  );
  assert.equal(result[0].round, 1);
  assert.equal(result[0].date.date, '۱۴۰۵/۰۵/۱۰');
});

test('pagination follows provider links and deduplicates match IDs', async () => {
  const next = `${base}${seasonPath}/fixtures?skip=40`;
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    return calls.length === 1
      ? page([1, 2], [{ rel: 'next', href: next }])
      : page([2, 3]);
  };

  const result = await fetchSeasonMatches(3, 902037, { requestJson });

  assert.equal(calls.length, 2);
  assert.deepEqual(
    result.matches.map((entry) => entry.match.id),
    [1, 2, 3]
  );
});

test('pagination does not follow another origin', async () => {
  let calls = 0;
  const requestJson = async () => {
    calls += 1;
    return page([1], [
      {
        rel: 'next',
        href: `https://attacker.example${seasonPath}/fixtures?skip=40`
      }
    ]);
  };

  await fetchSeasonMatches(3, 902037, { requestJson });
  assert.equal(calls, 1);
});

test('pagination ignores links outside the expected season path', async () => {
  let calls = 0;
  const requestJson = async () => {
    calls += 1;
    return page([1], [
      {
        rel: 'next',
        href: `${base}/football/leagues/3/seasons/other/fixtures?skip=40`
      }
    ]);
  };

  await fetchSeasonMatches(3, 902037, { requestJson });
  assert.equal(calls, 1);
});

test('pagination stops at the configured maximum page count', async () => {
  let calls = 0;
  const requestJson = async () => {
    calls += 1;
    return page([calls], [
      {
        rel: 'next',
        href: `${base}${seasonPath}/fixtures?skip=${calls}`
      }
    ]);
  };

  const result = await fetchSeasonMatches(3, 902037, {
    requestJson,
    maxPages: 3
  });

  assert.equal(calls, 3);
  assert.equal(result.pageLimitReached, true);
});
