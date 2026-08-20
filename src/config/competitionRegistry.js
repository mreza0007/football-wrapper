'use strict';

const competitions = [
  {
    competition_key: 'premier_league',
    name_fa: 'لیگ برتر انگلیس',
    name_en: 'Premier League',
    type: 'domestic_league',
    status: 'upcoming',
    is_active: true,
    default_season_key: '2026-2027',
    capabilities: {
      supports_matches: true,
      supports_teams: true,
      supports_standings: true,
      supports_live: true,
      supports_events: true
    }
  }
];

const seasons = [
  {
    competition_key: 'premier_league',
    season_key: '2026-2027',
    name_fa: 'فصل ۲۰۲۶-۲۰۲۷',
    name_en: '2026-2027',
    status: 'upcoming',
    is_default: true,
    capabilities: {
      supports_matches: true,
      supports_teams: true,
      supports_standings: true,
      supports_live: true,
      supports_events: true
    }
  }
];

module.exports = { competitions, seasons };
