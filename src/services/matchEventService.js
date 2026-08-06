'use strict';

const varzesh3 = require('../providers/varzesh3');
const matchLocatorService = require('./matchLocatorService');
const { ProviderRequestError } = require('../providers/varzesh3/httpClient');
const {
  EventsUnavailableError
} = require('../providers/varzesh3/eventData');

class EventProviderUnavailableError extends Error {
  constructor() {
    super('Provider unavailable');
    this.name = 'EventProviderUnavailableError';
    this.status = 502;
    this.publicMessage = 'Provider unavailable';
  }
}

async function getMatchEvents(matchId) {
  const locator = await matchLocatorService.resolveMatch(matchId);

  try {
    const providerResult = await varzesh3.getMatchEvents(
      locator.external_match_id
    );
    const events = varzesh3.normalizeEvents(
      providerResult.events,
      locator.snapshot
    );
    if (providerResult.stale) {
      return {
        locator,
        events,
        stale: true,
        warnings: ['events_provider_unavailable_using_cache'],
        mode: 'stale_cache'
      };
    }
    return {
      locator,
      events,
      stale: false,
      warnings: [],
      mode: events.length === 0 ? 'empty' : 'provider'
    };
  } catch (error) {
    if (error instanceof EventsUnavailableError) {
      return {
        locator,
        events: [],
        stale: false,
        warnings: ['events_not_available'],
        mode: 'not_available'
      };
    }
    if (error instanceof ProviderRequestError) {
      throw new EventProviderUnavailableError();
    }
    throw error;
  }
}

module.exports = { EventProviderUnavailableError, getMatchEvents };
