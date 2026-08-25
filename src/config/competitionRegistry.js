'use strict';

function capabilities(supportsStandings = true) {
  return {
    supports_matches: true,
    supports_teams: true,
    supports_standings: supportsStandings,
    supports_live: true,
    supports_events: true
  };
}

const competitionDefinitions = [
  ['premier_league', 'لیگ برتر انگلیس', 'Premier League', 'domestic_league', '2026-2027', true],
  ['persian_gulf_pro_league', 'لیگ برتر خلیج فارس', 'Persian Gulf Pro League', 'domestic_league', '1405-1406', true],
  ['la_liga', 'لالیگا', 'La Liga', 'domestic_league', '2026-2027', true],
  ['serie_a', 'سری آ', 'Serie A', 'domestic_league', '2026-2027', true],
  ['bundesliga', 'بوندس‌لیگا', 'Bundesliga', 'domestic_league', '2026-2027', true],
  ['ligue_1', 'لیگ ۱ فرانسه', 'Ligue 1', 'domestic_league', '2026-2027', true],
  ['champions_league', 'لیگ قهرمانان اروپا', 'UEFA Champions League', 'continental_club_competition', '2026-2027', false],
  ['europa_league', 'لیگ اروپا', 'UEFA Europa League', 'continental_club_competition', '2026-2027', false]
];

const competitions = competitionDefinitions.map(
  ([competitionKey, nameFa, nameEn, type, seasonKey, supportsStandings]) => ({
    competition_key: competitionKey,
    name_fa: nameFa,
    name_en: nameEn,
    type,
    status: 'active',
    is_active: true,
    default_season_key: seasonKey,
    capabilities: capabilities(supportsStandings)
  })
);

const seasons = competitionDefinitions.map(
  ([competitionKey, , , , seasonKey, supportsStandings]) => ({
    competition_key: competitionKey,
    season_key: seasonKey,
    name_fa: `فصل ${seasonKey}`,
    name_en: seasonKey,
    status: 'active',
    is_default: true,
    capabilities: capabilities(supportsStandings)
  })
);

module.exports = { competitions, seasons };
