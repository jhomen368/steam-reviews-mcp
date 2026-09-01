import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SteamAPIClient } from '../build/utils/steam-api.js';

const config = {
  cacheEnabled: true,
  cacheTTL: {
    reviews: 900000,
    gameInfo: 7200000,
    statistics: 300000,
    analysis: 1800000,
  },
  cacheMaxSize: 10,
  rateLimitEnabled: false,
  maxRequestsPerMinute: 30,
  httpMode: false,
  port: 8086,
  logLevel: 'error',
};

async function loadFixture(name) {
  const contents = await readFile(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8');
  return JSON.parse(contents);
}

class FixtureSteamClient extends SteamAPIClient {
  constructor(response) {
    super(config);
    this.response = response;
    this.requests = [];
  }

  async get(url, cacheKey, cacheTTL) {
    this.requests.push({ url, cacheKey, cacheTTL });
    return structuredClone(this.response);
  }
}

test('retrieves a Verified Steam Deck report through the shared request path', async () => {
  const client = new FixtureSteamClient(await loadFixture('steam-deck-verified'));

  const result = await client.getDeckCompatibility(620);

  const request = client.requests[0];
  const url = new URL(request.url);
  assert.equal(
    url.origin + url.pathname,
    'https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport'
  );
  assert.deepEqual(Object.fromEntries(url.searchParams), { nAppID: '620' });
  assert.equal(request.cacheKey, 'deck_compatibility_620');
  assert.equal(request.cacheTTL, config.cacheTTL.gameInfo);
  assert.deepEqual(result, {
    source: 'valve_steam_deck_compatibility',
    category: 'verified',
    categoryCode: 3,
    testResults: [
      {
        displayType: 4,
        token: '#SteamDeckVerified_TestResult_DefaultControllerConfigFullyFunctional',
      },
    ],
  });
});

test('names every known Steam Deck compatibility category', async () => {
  const cases = [
    ['steam-deck-unsupported', 'unsupported', 1],
    ['steam-deck-playable', 'playable', 2],
    ['steam-deck-verified', 'verified', 3],
    ['steam-deck-unknown', 'unknown', 0],
  ];

  for (const [fixture, category, categoryCode] of cases) {
    const client = new FixtureSteamClient(await loadFixture(fixture));
    const result = await client.getDeckCompatibility(620);

    assert.equal(result.category, category);
    assert.equal(result.categoryCode, categoryCode);
  }
});

test('reports no published Steam Deck result as Unknown, not Unsupported', async () => {
  const client = new FixtureSteamClient(await loadFixture('steam-deck-no-result'));

  const result = await client.getDeckCompatibility(620);

  assert.deepEqual(result, {
    source: 'valve_steam_deck_compatibility',
    category: 'unknown',
    categoryCode: null,
    testResults: [],
  });
});

test('preserves unknown category codes and test-result values', async () => {
  const client = new FixtureSteamClient(await loadFixture('steam-deck-unknown-values'));

  const result = await client.getDeckCompatibility(620);

  assert.deepEqual(result, {
    source: 'valve_steam_deck_compatibility',
    category: 'unknown',
    categoryCode: 99,
    testResults: [
      {
        displayType: 99,
        token: '#SteamDeckVerified_TestResult_FutureValveToken',
      },
    ],
  });
});

test('rejects malformed Steam Deck data instead of inventing compatibility evidence', async () => {
  const client = new FixtureSteamClient(await loadFixture('steam-deck-malformed'));

  await assert.rejects(
    client.getDeckCompatibility(620),
    /Malformed Steam Deck compatibility response for AppID 620/
  );
});
