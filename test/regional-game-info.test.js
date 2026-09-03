import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import axios from 'axios';

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

test('returns Steam regional quote and request context', async () => {
  const client = new FixtureSteamClient(await loadFixture('appdetails-regional-price'));

  const [game] = await client.getAppDetails(620, { country: 'de', language: 'german' });

  const request = client.requests[0];
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, 'https://store.steampowered.com/api/appdetails');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    appids: '620',
    cc: 'de',
    l: 'german',
  });
  assert.equal(request.cacheKey, 'appdetails_620_de_german');
  assert.equal(request.cacheTTL, config.cacheTTL.gameInfo);
  assert.equal(game.shortDescription, 'Das kooperative Testprogramm');
  assert.equal(game.currency, 'EUR');
  assert.equal(game.priceFormatted, '9,99€');
  assert.deepEqual(game.storefront, {
    country: 'de',
    language: 'german',
    languageStatus: 'requested_not_verified',
    priceStatus: 'available',
  });
});

test('distinguishes free games from paid games without a quote', async () => {
  const freeClient = new FixtureSteamClient(await loadFixture('appdetails-free'));
  const unavailableClient = new FixtureSteamClient(await loadFixture('appdetails-missing-price'));

  const [freeGame] = await freeClient.getAppDetails(730);
  const [unavailableGame] = await unavailableClient.getAppDetails(480, {
    country: 'de',
    language: 'german',
  });

  assert.equal(freeGame.isFree, true);
  assert.equal(freeGame.priceFormatted, 'Free');
  assert.equal(freeGame.priceRaw, 0);
  assert.equal(freeGame.currency, undefined);
  assert.equal(freeGame.storefront.priceStatus, 'free');

  assert.equal(unavailableGame.isFree, false);
  assert.equal(unavailableGame.priceFormatted, undefined);
  assert.equal(unavailableGame.priceRaw, undefined);
  assert.equal(unavailableGame.currency, undefined);
  assert.equal(unavailableGame.storefront.priceStatus, 'unavailable');
});

test('reports an unreleased game without presenting it as free', async () => {
  const client = new FixtureSteamClient(await loadFixture('appdetails-unreleased'));

  const [game] = await client.getAppDetails(220);

  assert.equal(game.isFree, false);
  assert.equal(game.priceFormatted, undefined);
  assert.equal(game.storefront.priceStatus, 'unreleased');
});

test('does not claim Steam confirmed the requested translation', async () => {
  const client = new FixtureSteamClient(await loadFixture('appdetails-language-fallback'));

  const [game] = await client.getAppDetails(620, { country: 'de', language: 'german' });

  assert.equal(game.shortDescription, 'The cooperative testing initiative');
  assert.equal(game.storefront.language, 'german');
  assert.equal(game.storefront.languageStatus, 'requested_not_verified');
});

test('isolates game-information cache entries by country and language', async () => {
  const client = new FixtureSteamClient(await loadFixture('appdetails-regional-price'));

  await client.getAppDetails(620, { country: 'de', language: 'german' });
  await client.getAppDetails(620, { country: 'at', language: 'german' });
  await client.getAppDetails(620, { country: 'de', language: 'english' });

  assert.deepEqual(
    client.requests.map((request) => request.cacheKey),
    ['appdetails_620_de_german', 'appdetails_620_at_german', 'appdetails_620_de_english']
  );
});

test('returns storefront context when Steam has no app details', async () => {
  const client = new FixtureSteamClient(await loadFixture('appdetails-unavailable'));

  const [result] = await client.getAppDetails(999, { country: 'de', language: 'german' });

  assert.deepEqual(result, {
    appId: 999,
    storefront: {
      country: 'de',
      language: 'german',
      languageStatus: 'requested_not_verified',
      priceStatus: 'unavailable',
    },
    warnings: [
      {
        source: 'steam_store',
        message: 'Steam Store information is unavailable for AppID 999',
      },
    ],
  });
});

test('does not present a malformed regional quote as available', async () => {
  const client = new FixtureSteamClient(await loadFixture('appdetails-malformed-price'));

  const [game] = await client.getAppDetails(480);

  assert.equal(game.storefront.priceStatus, 'unavailable');
  assert.equal(game.currency, undefined);
  assert.equal(game.priceFormatted, undefined);
  assert.deepEqual(game.warnings, [
    {
      source: 'steam_store',
      message: 'Steam returned a malformed regional quote for AppID 480',
    },
  ]);
});

test('returns an unavailable result for malformed app details', async () => {
  const client = new FixtureSteamClient(await loadFixture('appdetails-malformed'));

  const [result] = await client.getAppDetails(620);

  assert.equal(result.appId, 620);
  assert.equal(result.name, undefined);
  assert.equal(result.storefront.priceStatus, 'unavailable');
  assert.equal(result.warnings[0].source, 'steam_store');
});

test('uses shared cache, rate limiting, and retry behavior for regional requests', async () => {
  const response = await loadFixture('appdetails-regional-price');
  const client = new SteamAPIClient({ ...config, rateLimitEnabled: true });
  const originalGet = axios.get;
  let attempts = 0;

  axios.get = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' });
    }
    return { data: structuredClone(response) };
  };

  try {
    await client.getAppDetails(620, { country: 'de', language: 'german' });
    await client.getAppDetails(620, { country: 'de', language: 'german' });
    await client.getAppDetails(620, { country: 'de', language: 'english' });
  } finally {
    axios.get = originalGet;
  }

  assert.equal(attempts, 3);
  const cacheStats = client.getCacheStats();
  assert.equal(cacheStats.size, 2);
  assert.equal(cacheStats.hits, 1);
  assert.equal(cacheStats.misses, 2);
  assert.equal(Math.abs(cacheStats.hitRate - 100 / 3) < 0.000001, true);
  const rateLimitStatus = client.getRateLimiterStatus();
  assert.equal(rateLimitStatus.remaining, 28);
  assert.equal(rateLimitStatus.total, 30);
  assert.equal(rateLimitStatus.resetTime > Date.now(), true);
});
