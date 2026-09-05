'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchSeasonOverviewMatches,
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

function overviewMatch(id, status, kickoff = '2026-09-01T12:00:00Z') {
  return { id, status, utcTime: kickoff };
}

function overviewPage(matches, links = []) {
  return {
    _links: links,
    items: [
      {
        round: 'current',
        dates: [{ date: '1405/06/10', matches }]
      }
    ]
  };
}

test('overview stops after the base page when both quotas are satisfied', async () => {
  let calls = 0;
  const matches = [
    overviewMatch(1, 2, null),
    ...Array.from({ length: 5 }, (_, index) =>
      overviewMatch(10 + index, 1, `2026-09-0${index + 2}T12:00:00Z`)
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      overviewMatch(20 + index, 7, `2026-08-${20 + index}T12:00:00Z`)
    )
  ];
  const result = await fetchSeasonOverviewMatches(3, 902037, {
    requestJson: async () => {
      calls += 1;
      return overviewPage(matches, [
        { rel: 'next', href: `${base}${seasonPath}/fixtures?skip=5` },
        { rel: 'prev', href: `${base}${seasonPath}/results?skip=5` }
      ]);
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.matches.length, 11);
  assert.equal(result.pageLimitReached, false);
});

test('overview follows only the supplied next link when upcoming quota is missing', async () => {
  const next = `${base}${seasonPath}/fixtures?skip=5`;
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    if (url === next) {
      return overviewPage(
        Array.from({ length: 5 }, (_, index) =>
          overviewMatch(30 + index, 1, `2026-09-${10 + index}T12:00:00Z`)
        )
      );
    }
    return overviewPage(
      Array.from({ length: 5 }, (_, index) =>
        overviewMatch(40 + index, 7, `2026-08-${20 + index}T12:00:00Z`)
      ),
      [{ rel: 'next', href: next }]
    );
  };

  await fetchSeasonOverviewMatches(3, 902037, { requestJson });
  assert.deepEqual(calls, [`${base}${seasonPath}/matches`, next]);
});

test('overview follows only the supplied prev link when finished quota is missing', async () => {
  const prev = `${base}${seasonPath}/results?skip=5`;
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    if (url === prev) {
      return overviewPage(
        Array.from({ length: 5 }, (_, index) =>
          overviewMatch(50 + index, 7, `2026-08-${20 + index}T12:00:00Z`)
        )
      );
    }
    return overviewPage(
      Array.from({ length: 5 }, (_, index) =>
        overviewMatch(60 + index, 1, `2026-09-${10 + index}T12:00:00Z`)
      ),
      [{ rel: 'prev', href: prev }]
    );
  };

  await fetchSeasonOverviewMatches(3, 902037, { requestJson });
  assert.deepEqual(calls, [`${base}${seasonPath}/matches`, prev]);
});

test('overview traverses bounded next and prev directions when both quotas are missing', async () => {
  const next = `${base}${seasonPath}/fixtures?skip=5`;
  const prev = `${base}${seasonPath}/results?skip=5`;
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    if (url === next) {
      return overviewPage(
        Array.from({ length: 5 }, (_, index) =>
          overviewMatch(70 + index, 1, `2026-09-${10 + index}T12:00:00Z`)
        )
      );
    }
    if (url === prev) {
      return overviewPage(
        Array.from({ length: 5 }, (_, index) =>
          overviewMatch(80 + index, 7, `2026-08-${20 + index}T12:00:00Z`)
        )
      );
    }
    return overviewPage([overviewMatch(90, 2, null)], [
      { rel: 'next', href: next },
      { rel: 'prev', href: prev }
    ]);
  };

  await fetchSeasonOverviewMatches(3, 902037, { requestJson });
  assert.deepEqual(calls, [`${base}${seasonPath}/matches`, next, prev]);
});

test('overview never invents or follows mismatched pagination resources', async () => {
  let calls = 0;
  await fetchSeasonOverviewMatches(3, 902037, {
    requestJson: async () => {
      calls += 1;
      return overviewPage([], [
        { rel: 'next', href: `${base}${seasonPath}/results?skip=1` },
        { rel: 'prev', href: `${base}${seasonPath}/fixtures?skip=1` }
      ]);
    }
  });
  assert.equal(calls, 1);
});

test('overview hard page bound stops directional traversal', async () => {
  let calls = 0;
  const requestJson = async () => {
    calls += 1;
    return overviewPage(
      [overviewMatch(100 + calls, 1, `2026-09-${calls + 1}T12:00:00Z`)],
      [
        {
          rel: 'next',
          href: `${base}${seasonPath}/fixtures?skip=${calls}`
        }
      ]
    );
  };

  const result = await fetchSeasonOverviewMatches(3, 902037, {
    requestJson,
    maxPages: 2
  });
  assert.equal(calls, 2);
  assert.equal(result.pageLimitReached, true);
});

test('overview recomputes quotas before fetching the second direction', async () => {
  const next = `${base}${seasonPath}/fixtures?skip=5`;
  const prev = `${base}${seasonPath}/results?skip=5`;
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    if (url === next) {
      return overviewPage([
        ...Array.from({ length: 5 }, (_, index) =>
          overviewMatch(200 + index, 1, `2026-09-${10 + index}T12:00:00Z`)
        ),
        ...Array.from({ length: 5 }, (_, index) =>
          overviewMatch(210 + index, 7, `2026-08-${20 + index}T12:00:00Z`)
        )
      ]);
    }
    if (url === prev) {
      throw new Error('prev should not be fetched after both quotas are met');
    }
    return overviewPage([], [
      { rel: 'next', href: next },
      { rel: 'prev', href: prev }
    ]);
  };

  await fetchSeasonOverviewMatches(3, 902037, { requestJson });
  assert.deepEqual(calls, [`${base}${seasonPath}/matches`, next]);
});

test('overview cyclic pagination link is not fetched twice', async () => {
  const next = `${base}${seasonPath}/fixtures?skip=5`;
  const calls = [];
  const requestJson = async (url) => {
    calls.push(url);
    return url === next
      ? overviewPage([], [{ rel: 'next', href: next }])
      : overviewPage([], [{ rel: 'next', href: next }]);
  };

  const result = await fetchSeasonOverviewMatches(3, 902037, { requestJson });
  assert.deepEqual(calls, [`${base}${seasonPath}/matches`, next]);
  assert.equal(result.pagesFetched, 2);
});
