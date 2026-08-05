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

The server listens on `PORT`, falling back to `3060`.

## Endpoints

- `GET /health`
- `GET /competitions`
- `GET /competitions/:competitionKey`
- `GET /competitions/:competitionKey/seasons`
- `GET /competitions/:competitionKey/seasons/:seasonKey`
- `GET /competitions/:competitionKey/seasons/:seasonKey/matches`
- `GET /competitions/:competitionKey/seasons/:seasonKey/standings`
- `GET /competitions/:competitionKey/seasons/:seasonKey/teams`

All responses are JSON. Unknown resources and routes return JSON `404` errors.

The matches endpoint accepts `?status=all`, `upcoming`, `live`, or `finished`; the default is `all`.

The teams endpoint uses non-empty standings as the authoritative season roster and fills missing standings names or logos from season matches. If standings are empty or unavailable, it derives and deduplicates teams from matches and returns a fallback warning. Team IDs use the same stable wrapper identity as match and standings records. A provider team ID of zero is never canonical; unresolved identities remain `null` and include a `team_identity_unresolved` warning.

## Provider configuration

- `VARZESH3_BASE_URL` defaults to `https://web-api.varzesh3.com/v2.0`.
- `VARZESH3_TIMEOUT_MS` defaults to `30000` milliseconds.

Match pagination follows only provider `next` and `prev` links on the configured origin and expected league/season path. It does not assume page sizes or skip increments and stops after at most 50 fetched pages.

`kickoff_utc` remains `null` when the season feed does not provide a genuinely valid UTC timestamp. The original Persian date and Iran time are preserved, and the match includes a `kickoff_utc_unresolved` warning.

`npm run probe:varzesh3` is the manual online provider check. It prints counts and one normalized sample of each resource, never the full provider payload. The regular test suite mocks `fetch` and stays offline.

## Current limitations

- Only the Premier League and its 2026-2027 season are configured.
- Match, standings, and team data are read directly from the configured provider without persistence.
- Dedicated live-score enrichment and event fetching are not implemented.
- There is no database, frontend, or authentication.
