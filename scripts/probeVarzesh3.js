'use strict';

require('dotenv').config({ quiet: true });

const competitionDataService = require('../src/services/competitionDataService');
const liveMatchService = require('../src/services/liveMatchService');
const varzesh3 = require('../src/providers/varzesh3');

async function main() {
  const competitionKey = 'premier_league';
  const seasonKey = '2026-2027';
  const matchResult = await competitionDataService.getMatches(
    competitionKey,
    seasonKey
  );
  const standings = await competitionDataService.getStandings(
    competitionKey,
    seasonKey
  );
  const teamResult = await competitionDataService.getTeams(
    competitionKey,
    seasonKey
  );
  const todayLivescoreMatches = await varzesh3.getTodayLivescore();
  const liveLookup = await liveMatchService.getLiveMatch(
    matchResult.matches[0].id
  );
  const unresolvedMatchTeamIdentities = matchResult.matches.reduce(
    (count, match) =>
      count +
      Number(match.home_team_id === null) +
      Number(match.away_team_id === null),
    0
  );
  const skippedWarning = matchResult.warnings.find((warning) =>
    warning.startsWith('provider_matches_skipped_unknown_status:')
  );
  const skippedUnknownStatus = skippedWarning
    ? Number(skippedWarning.split(':')[1])
    : 0;

  console.log(
    JSON.stringify(
      {
        match_count: matchResult.matches.length,
        standings_count: standings.length,
        teams_count: teamResult.teams.length,
        today_livescore_match_count: todayLivescoreMatches.length,
        today_live_match_count: todayLivescoreMatches.filter(
          (match) => varzesh3.normalizeStatus(match) === 'live'
        ).length,
        live_lookup_mode: liveLookup.mode,
        unresolved_team_identities: teamResult.teams.filter(
          (team) => team.id === null
        ).length,
        unresolved_match_team_identities: unresolvedMatchTeamIdentities,
        skipped_unknown_status: skippedUnknownStatus,
        match_warnings: matchResult.warnings,
        teams_warnings: teamResult.warnings,
        match_sample: matchResult.matches[0] ?? null,
        standing_sample: standings[0] ?? null,
        team_sample: teamResult.teams[0] ?? null,
        live_endpoint_sample: liveLookup.match
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`Varzesh3 probe failed: ${error.publicMessage || error.message}`);
  process.exitCode = 1;
});
