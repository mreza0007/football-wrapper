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
to the loopback listener.

`SIGTERM` and `SIGINT` stop new connections and allow active requests to finish.
Connections still open after the shutdown timeout are force-closed and produce
a nonzero process exit status. Lifecycle and server-side HTTP failures are
logged concisely to stdout or stderr without request bodies, headers, provider
payloads, provider URLs, credentials, or stack traces. Successful requests are
not logged by the application.

## Endpoints

- `GET /health`
- `GET /competitions`
- `GET /competitions/:competitionKey`
- `GET /competitions/:competitionKey/seasons`
- `GET /competitions/:competitionKey/seasons/:seasonKey`
- `GET /competitions/:competitionKey/seasons/:seasonKey/matches`
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
- `VARZESH3_STANDINGS_CACHE_TTL_MS` defaults to `30000` milliseconds.
- `VARZESH3_SEASON_CACHE_MAX_ENTRIES` defaults to `100` total season-data entries.
- `MATCH_INDEX_TTL_MS` defaults to `300000` milliseconds.
- `MATCH_INDEX_REFRESH_GUARD_MS` defaults to `30000` milliseconds.
- `VARZESH3_EVENTS_CACHE_TTL_MS` defaults to `10000` milliseconds.
- `VARZESH3_EVENTS_CACHE_MAX_ENTRIES` defaults to `500` matches.

Match pagination follows only provider `next` and `prev` links on the configured origin and expected league/season path. It does not assume page sizes or skip increments and stops after at most 50 fetched pages.

`kickoff_utc` remains `null` when the season feed does not provide a genuinely valid UTC timestamp. The original Persian date and Iran time are preserved, and the match includes a `kickoff_utc_unresolved` warning.

`npm run probe:varzesh3` is the manual online provider check. It prints counts and one normalized sample of each resource, never the full provider payload. The regular test suite mocks `fetch` and stays offline.

Season matches and standings use one shared process-local provider cache before
public normalization. Matches, standings, teams, and match-index hydration reuse
the same season-scoped entries and share concurrent in-flight requests. Matches
and standings have separate cache keys, and public match status filters are
applied after the full season result is retrieved. Set either season-data TTL to
`0` to disable reuse. The combined cache is bounded by
`VARZESH3_SEASON_CACHE_MAX_ENTRIES` using least-recently-used eviction.

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
