# Generic Football Wrapper

A standalone, provider-independent HTTP API foundation for exposing football data across multiple competitions and seasons. This phase provides registry and adapter boundaries only; it does not fetch football data.

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
```

The server listens on `PORT`, falling back to `3060`.

## Endpoints

- `GET /health`
- `GET /competitions`
- `GET /competitions/:competitionKey`
- `GET /competitions/:competitionKey/seasons`
- `GET /competitions/:competitionKey/seasons/:seasonKey`

All responses are JSON. Unknown resources and routes return JSON `404` errors.

## Current limitations

- Only the Premier League and its 2026-2027 season are configured.
- There are no external provider HTTP requests.
- Match, team, standings, live, and event fetching are not implemented.
- There is no database, frontend, or authentication.
