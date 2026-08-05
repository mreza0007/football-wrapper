'use strict';

require('dotenv').config({ quiet: true });

const competitionDataService = require('../src/services/competitionDataService');

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
  const unresolvedTeamIdentities = matchResult.matches.reduce(
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
        unresolved_team_identities: unresolvedTeamIdentities,
        skipped_unknown_status: skippedUnknownStatus,
        warnings: matchResult.warnings,
        match_sample: matchResult.matches[0] ?? null,
        standing_sample: standings[0] ?? null
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
