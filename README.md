# Generic Football Wrapper

A standalone, provider-independent HTTP API for exposing football data across multiple competitions and seasons. It currently provides read-only Premier League season matches, standings, and teams through a Varzesh3 adapter.

## Architecture boundary

Public routes read provider-neutral competition and season records through service modules. Provider-specific identifiers and mappings live exclusively inside provider adapters under `src/providers/`. This separation allows future providers to be added or replaced without changing the public API.

MatchPulse must never call Varzesh3 directly. It must use this wrapper, and provider-specific league and season IDs must remain inside provider adapters and must never appear in public responses.

## Installation

Node.js 20 or newer is required.

```sh
npm install
```

Copy `.env.example` to `.env` if you need local environment overrides.

## Commands

```sh
npm start
npm run dev
npm test
npm run probe:varzesh3
```

The production server listens on `HOST` and `PORT`. `HOST` defaults to
`127.0.0.1` and `PORT` defaults to `3060`, so the service is loopback-only by
default. Set `HOST` explicitly when container or local-network binding is
required. `SHUTDOWN_TIMEOUT_MS` defaults to `10000` milliseconds and controls
how long active requests may finish during graceful shutdown.

Keep the wrapper behind Nginx rather than exposing its application port
directly. Nginx should provide the public network boundary and forward traffic
to the loopback listener when public or remote access is introduced. Nginx is
not needed for loopback traffic from MatchPulse on the same VPS.

`SIGTERM` and `SIGINT` stop new connections and allow active requests to finish.
Connections still open after the shutdown timeout are force-closed and produce
a nonzero process exit status. Lifecycle and server-side HTTP failures are
logged concisely to stdout or stderr without request bodies, headers, provider
payloads, provider URLs, credentials, or stack traces. Successful requests are
not logged by the application.

## Production deployment

The generic wrapper is an independent service with these production locations:

- Application directory: `/opt/football-wrapper`
- Environment file: `/etc/football-wrapper/football-wrapper.env`
- systemd unit: `/etc/systemd/system/generic-football-wrapper.service`
- Service account and group: `football-wrapper`

Use `.env.production.example` as the value template for the environment file.
The application source should be owned by `root:football-wrapper`; the service
account needs read and execute access but should not normally have write access.
The environment file should be owned by `root:football-wrapper` with mode
`0640`.

Before installing the supplied unit, verify the absolute Node.js path on the
VPS and adjust `ExecStart` if it is not `/usr/bin/node`:

```sh
command -v node
```

Install production dependencies from the application directory without
copying a workstation's `node_modules`:

```sh
npm ci --omit=dev
```

Install `deploy/generic-football-wrapper.service` at the systemd unit path and
load it with `systemctl daemon-reload`. A daemon reload is required only when
the unit changes. Enable and start the service according to the VPS's normal
administration policy.

Use these bounded operational checks:

```sh
systemctl status generic-football-wrapper.service --no-pager
journalctl -u generic-football-wrapper.service -n 100 --no-pager
curl --fail --silent --show-error http://127.0.0.1:3060/health
systemctl restart generic-football-wrapper.service
```

For an update:

1. Stop `generic-football-wrapper.service`.
2. Replace the application source with a clean new revision.
3. Run `npm ci --omit=dev` in `/opt/football-wrapper`.
4. Restore the intended `root:football-wrapper` ownership if necessary.
5. Start or restart the service.
6. Verify service status and the bounded journal output above.
7. Run the loopback health check above.

The repository currently has no Git remote. Supported manual source-transfer
options are a `git archive` from a known clean commit followed by SCP, or
rsync/SCP from a clean working tree. Do not transfer `node_modules`, `.env`, test
artifacts, temporary probe payloads, or other generated files.

MatchPulse on the same VPS should eventually consume
`http://127.0.0.1:3060`. Keep the wrapper bound to loopback, do not add Nginx
for this internal traffic, and do not open port `3060` in the firewall.
MatchPulse integration is a separate phase.

Deployment is isolated from the existing World Cup wrapper:

- `/opt/worldcup2026` and its systemd services remain untouched.
- `generic-football-wrapper.service` is independent and does not replace the
  World Cup wrapper.
- This phase does not change `WORLDCUP_WRAPPER_URL` or MatchPulse routes, add
  Premier League UI/data consumption, remove `worldcup2026`, or expose the new
  wrapper publicly.

## Endpoints

- `GET /health`
- `GET /competitions`
- `GET /competitions/:competitionKey`
- `GET /competitions/:competitionKey/seasons`
- `GET /competitions/:competitionKey/seasons/:seasonKey`
- `GET /competitions/:competitionKey/seasons/:seasonKey/matches`
- `GET /competitions/:competitionKey/seasons/:seasonKey/overview`
- `GET /competitions/:competitionKey/seasons/:seasonKey/standings`
- `GET /competitions/:competitionKey/seasons/:seasonKey/teams`
- `GET /matches/:matchId/live`
- `GET /matches/:matchId/events`

All responses are JSON. Unknown resources and routes return JSON `404` errors.

The matches endpoint accepts `?status=all`, `upcoming`, `live`, or `finished`; the default is `all`.

The teams endpoint uses non-empty standings as the authoritative season roster and fills missing standings names or logos from season matches. If standings are empty or unavailable, it derives and deduplicates teams from matches and returns a fallback warning. Team IDs use the same stable wrapper identity as match and standings records. A provider team ID of zero is never canonical; unresolved identities remain `null` and include a `team_identity_unresolved` warning.

The live endpoint resolves the opaque stable match ID through an in-memory season index and enriches the normalized season snapshot from Varzesh3's today livescore feed. If the match is absent from today's feed, it returns the season snapshot with a warning. If the live provider is unavailable after the match is resolved, it returns a stale season snapshot with a safe warning instead of exposing provider details.

The events endpoint uses the same stable match lookup and confirmed Varzesh3 `eventType` behavior to normalize goals, own goals, penalty goals, missed penalties, yellow/red cards, substitutions, VAR, kickoff, halftime, and fulltime records. Penalty event type `3` remains neutral unless an explicit provider outcome proves that it was scored or missed. Penalty-shootout kicks are not treated as regulation scoring events, and a second-yellow red card requires explicit provider evidence rather than a numeric card subtype alone. Provider event IDs produce deterministic match-scoped wrapper IDs; events without provider IDs retain `null` IDs and are never assigned fabricated canonical identities. Structurally empty responses return an empty success, while provider `404`/`410` responses return `events_not_available`.

## Provider configuration

- `HOST` defaults to `127.0.0.1`.
- `PORT` defaults to `3060`.
- `SHUTDOWN_TIMEOUT_MS` defaults to `10000` milliseconds.

- `VARZESH3_BASE_URL` defaults to `https://web-api.varzesh3.com/v2.0`.
- `VARZESH3_TIMEOUT_MS` defaults to `30000` milliseconds.
- `VARZESH3_LIVESCORE_CACHE_TTL_MS` defaults to `10000` milliseconds.
- `VARZESH3_SEASON_MATCHES_CACHE_TTL_MS` defaults to `30000` milliseconds.
- `VARZESH3_OVERVIEW_CACHE_TTL_MS` defaults to `30000` milliseconds.
- `VARZESH3_OVERVIEW_CACHE_MAX_ENTRIES` defaults to `100`.
- `VARZESH3_STANDINGS_CACHE_TTL_MS` defaults to `30000` milliseconds.
- `VARZESH3_SEASON_CACHE_MAX_ENTRIES` defaults to `100` total season-data entries.
- `MATCH_INDEX_TTL_MS` defaults to `300000` milliseconds.
- `MATCH_INDEX_REFRESH_GUARD_MS` defaults to `30000` milliseconds.
- `VARZESH3_EVENTS_CACHE_TTL_MS` defaults to `10000` milliseconds.
- `VARZESH3_EVENTS_CACHE_MAX_ENTRIES` defaults to `500` matches.

Match pagination follows only provider `next` and `prev` links on the configured origin and expected league/season path. It does not assume page sizes or skip increments and stops after at most 50 fetched pages.

### Nearby daily matches

`GET /matches/by-date?date=YYYY-MM-DD` returns `{ date, groups, errors }`.
Each group contains `competition: { key, name, name_fa, season_key, type }`
and canonical normalized `matches`, ordered by registry order and kickoff/ID.
Only active configured football competitions with an unambiguous mapped league
and active default season are included. The feed has no season identifier, so
season assignment uses configuration, not provider display text.

Supported dates are the current **Asia/Tehran** calendar date plus offsets
-2, -1, 0, +1, +2. These map internally to the provider's verified
`/livescore/-2`, `/livescore/-1`, `/livescore/today`, `/livescore/1`,
and `/livescore/2`. Inclusion requires a valid timezone-aware `startOnUtc`
whose Tehran date matches the request. Provider display dates are not used
for inclusion. Unsupported leagues, malformed rows, unresolved kickoffs,
and unsupported statuses are skipped. There is no five-match quota.

Invalid dates and dates outside this window return 400. Provider failures,
malformed feed roots, and requests crossing Tehran midnight return a sanitized
502; retry midnight failures with the current calendar date. A successful
empty feed returns 200 with empty groups/errors. No full-season or overview
fallback is used, and daily reads do not replace the season match index.

Offset feeds share the existing livescore cache implementation: 10 seconds
by default (`VARZESH3_LIVESCORE_CACHE_TTL_MS`), at most five offset entries,
same-offset request coalescing, defensive copies, and no expired-data fallback.
Offset zero is shared with live-match retrieval. All offsets are invalidated
when the Tehran calendar day changes. Coverage is limited to matches supplied
by the verified daily feed; this is not an arbitrary historical date API.

`kickoff_utc` uses a valid provider UTC timestamp when available. If the provider UTC value is missing or invalid, the wrapper derives UTC from the preserved Persian date and Iran local time. When neither source can produce a valid kickoff timestamp, `kickoff_utc` remains `null` and the match includes a `kickoff_utc_unresolved` warning.

`npm run probe:varzesh3` is the manual online provider check. It prints counts and one normalized sample of each resource, never the full provider payload. The regular test suite mocks `fetch` and stays offline.

Season matches and standings use one shared process-local provider cache before
public normalization. Matches, standings, teams, and match-index hydration reuse
the same season-scoped entries and share concurrent in-flight requests. Matches
and standings have separate cache keys, and public match status filters are
applied after the full season result is retrieved. Set either season-data TTL to
`0` to disable reuse. The combined cache is bounded by
`VARZESH3_SEASON_CACHE_MAX_ENTRIES` using least-recently-used eviction.


Competition overviews use a separate process-local, competition-and-season scoped
cache. The overview fetch starts with the provider's bounded current `matches`
page and follows only provider-supplied `next` fixture or `prev` result links
when a five-match category quota is not met. It fetches at most five pages,
coalesces concurrent scope-identical requests, and does not serve stale entries.
The match index, season-data cache, and today-livescore cache are process-local
and are rebuilt after restarts. They are not shared across server processes.
After a completely successful configured-season index refresh, unknown stable
match IDs are rejected without another full scan for
`MATCH_INDEX_REFRESH_GUARD_MS`. Partial provider failures do not activate that
guard. Successful scope refreshes prune obsolete matches only from that scope;
failed scopes preserve their existing entries.

The per-match event cache is also process-local and size-bounded. Concurrent requests for one match share a refresh. If an expired cached event result exists and the provider refresh fails, the endpoint returns that cached result as stale with `events_provider_unavailable_using_cache`; without cache, provider failures return `502`.

## Current limitations

- Only the Premier League and its 2026-2027 season are configured.
- Match, standings, and team data are read directly from the configured provider without persistence.
- Live enrichment is limited to today's feed; historical/future offsets are not implemented.
- There is no database, frontend, or authentication.
- There is no direct MatchPulse integration; consumers must use this wrapper rather than calling Varzesh3.
