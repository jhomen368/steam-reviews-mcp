import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { SteamAPIClient } from '../build/utils/steam-api.js';
import { createToolModule } from '../build/tools.js';

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
  constructor(responses) {
    super(config);
    this.responses = responses;
    this.requests = [];
  }

  async get(url, cacheKey, cacheTTL) {
    this.requests.push({ url, cacheKey, cacheTTL });
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return structuredClone(response);
  }
}

test('preserves purchase notices and localized Store declarations from appdetails', async () => {
  const client = new FixtureSteamClient([await loadFixture('appdetails-purchase-features')]);

  const [game] = await client.getAppDetails(620, { country: 'de', language: 'german' });

  assert.deepEqual(game.purchaseNotices, {
    source: 'steam_store_declaration',
    thirdPartyAccount: {
      status: 'supplied',
      rawText: '  Drittanbieter-Konto: EA-Konto erforderlich  ',
    },
    drmOrLauncher: {
      status: 'supplied',
      rawText: 'Denuvo Anti-Tamper<br>5 Aktivierungen pro Tag',
    },
    absenceMeaning: 'not_supplied_is_not_evidence_of_absence',
  });
  assert.deepEqual(game.languageSupport, {
    source: 'steam_store_declaration',
    status: 'partial_raw_only',
    rawDeclaration:
      'Englisch<strong>*</strong>, Deutsch<br><strong>*</strong>Sprachen mit voller Audiounterstützung',
    languages: [],
  });
  assert.deepEqual(game.storeCategories, {
    source: 'steam_store_declaration',
    status: 'supplied',
    independentlyTested: false,
    items: [
      { id: 2, label: 'Einzelspieler' },
      { id: 1, label: 'Mehrspieler' },
      { id: 9, label: 'Koop' },
      { id: 18, label: 'Teilweise Controllerunterstützung' },
      { id: 22, label: 'Steam-Erfolge' },
      { id: 23, label: 'Steam Cloud' },
      { id: 28, label: 'Volle Controllerunterstützung' },
      { id: 9999, label: 'Zukünftige Funktion' },
    ],
  });
  assert.deepEqual(game.systemRequirements, {
    minimum: '<strong>Minimum:</strong> Deutsches Betriebssystem',
    recommended: '<strong>Empfohlen:</strong> Deutscher Prozessor',
  });
  assert.deepEqual(game.tags, undefined);
});

test('describes missing notices without claiming requirements are absent', async () => {
  const client = new FixtureSteamClient([
    await loadFixture('appdetails-missing-purchase-notices'),
  ]);

  const [game] = await client.getAppDetails(620);

  assert.deepEqual(game.purchaseNotices, {
    source: 'steam_store_declaration',
    thirdPartyAccount: { status: 'not_supplied', rawText: null },
    drmOrLauncher: { status: 'not_supplied', rawText: null },
    absenceMeaning: 'not_supplied_is_not_evidence_of_absence',
  });
  assert.deepEqual(game.languageSupport, {
    source: 'steam_store_declaration',
    status: 'unavailable',
    rawDeclaration: null,
    languages: [],
  });
  assert.deepEqual(game.storeCategories, {
    source: 'steam_store_declaration',
    status: 'not_supplied',
    independentlyTested: false,
    items: [],
  });
});

test('reports malformed Store declarations without discarding valid evidence', async () => {
  const client = new FixtureSteamClient([
    await loadFixture('appdetails-malformed-store-evidence'),
  ]);

  const [game] = await client.getAppDetails(620);

  assert.deepEqual(game.purchaseNotices, {
    source: 'steam_store_declaration',
    thirdPartyAccount: { status: 'malformed', rawText: null },
    drmOrLauncher: { status: 'malformed', rawText: null },
    absenceMeaning: 'not_supplied_is_not_evidence_of_absence',
  });
  assert.deepEqual(game.languageSupport, {
    source: 'steam_store_declaration',
    status: 'unavailable',
    rawDeclaration: null,
    languages: [],
  });
  assert.deepEqual(game.storeCategories, {
    source: 'steam_store_declaration',
    status: 'malformed',
    independentlyTested: false,
    items: [{ id: 22, label: 'Steam Achievements' }],
  });
  assert.deepEqual(game.warnings, [
    {
      source: 'steam_store',
      message:
        'Steam returned malformed Store declarations for AppID 620: third-party account notice, DRM or launcher notice, supported languages, categories',
    },
  ]);
});

test('retrieves structured language support through the shared request path', async () => {
  const client = new FixtureSteamClient([
    await loadFixture('store-items-structured-languages'),
  ]);

  const result = await client.getStructuredLanguageSupport([730, 620, 620], {
    country: 'de',
    language: 'german',
  });

  const request = client.requests[0];
  const url = new URL(request.url);
  assert.equal(
    url.origin + url.pathname,
    'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/'
  );
  assert.deepEqual(JSON.parse(url.searchParams.get('input_json')), {
    ids: [{ appid: 620 }, { appid: 730 }],
    context: { language: 'german', country_code: 'DE' },
    data_request: { include_supported_languages: true },
  });
  assert.equal(request.cacheKey, 'store_languages_620_730_de_german');
  assert.equal(request.cacheTTL, config.cacheTTL.gameInfo);
  assert.deepEqual(result.get(620), [
    {
      languageCode: 'english',
      languageId: 0,
      additionalLanguageId: -1,
      supported: true,
      fullAudio: true,
      subtitles: true,
    },
    {
      languageCode: 'koreana',
      languageId: 4,
      additionalLanguageId: -1,
      supported: true,
      fullAudio: false,
      subtitles: true,
    },
    {
      languageCode: 'brazilian',
      languageId: 22,
      additionalLanguageId: -1,
      supported: true,
      fullAudio: true,
      subtitles: true,
    },
    {
      languageCode: 'indonesian',
      languageId: 28,
      additionalLanguageId: -1,
      supported: true,
      fullAudio: false,
      subtitles: true,
    },
    {
      languageId: 99,
      additionalLanguageId: 42,
      supported: true,
      fullAudio: false,
      subtitles: false,
    },
  ]);
  assert.equal(result.has(730), false);
});

test('rejects malformed structured language data instead of inventing support', async () => {
  const client = new FixtureSteamClient([await loadFixture('store-items-malformed')]);

  await assert.rejects(
    client.getStructuredLanguageSupport([620]),
    /Malformed Steam structured language response/
  );
});

test('returns structured languages while retaining Steam raw declarations', async () => {
  const client = new FixtureSteamClient([
    await loadFixture('appdetails-purchase-features'),
    await loadFixture('store-items-structured-languages'),
    await loadFixture('steam-deck-no-result'),
  ]);
  const toolModule = createToolModule(client);

  const result = await toolModule.execute('get_game_info', {
    appIds: [620],
    country: 'de',
    language: 'german',
    includeStats: false,
  });
  const [game] = JSON.parse(result.content[0].text);

  assert.equal(result.isError, undefined);
  assert.equal(game.languageSupport.status, 'structured');
  assert.equal(
    game.languageSupport.rawDeclaration,
    'Englisch<strong>*</strong>, Deutsch<br><strong>*</strong>Sprachen mit voller Audiounterstützung'
  );
  assert.deepEqual(game.languageSupport.languages[0], {
    languageCode: 'english',
    languageId: 0,
    additionalLanguageId: -1,
    supported: true,
    fullAudio: true,
    subtitles: true,
  });
});

test('keeps base Store evidence when structured language enrichment fails', async () => {
  const client = new FixtureSteamClient([
    await loadFixture('appdetails-purchase-features'),
    await loadFixture('store-items-malformed'),
    await loadFixture('steam-deck-no-result'),
  ]);
  const toolModule = createToolModule(client);

  const result = await toolModule.execute('get_game_info', {
    appIds: [620],
    country: 'de',
    language: 'german',
    includeStats: false,
    includeRequirements: true,
  });
  const [game] = JSON.parse(result.content[0].text);

  assert.equal(result.isError, undefined);
  assert.equal(game.name, 'Portal 2');
  assert.equal(game.purchaseNotices.thirdPartyAccount.status, 'supplied');
  assert.equal(game.storeCategories.items.at(-1).id, 9999);
  assert.deepEqual(game.systemRequirements, {
    minimum: '<strong>Minimum:</strong> Deutsches Betriebssystem',
    recommended: '<strong>Empfohlen:</strong> Deutscher Prozessor',
  });
  assert.deepEqual(game.languageSupport, {
    source: 'steam_store_declaration',
    status: 'partial_raw_only',
    rawDeclaration:
      'Englisch<strong>*</strong>, Deutsch<br><strong>*</strong>Sprachen mit voller Audiounterstützung',
    languages: [],
  });
  assert.deepEqual(game.warnings, [
    {
      source: 'steam_language_support',
      message:
        'Structured Steam language support is unavailable for AppID 620; the raw declaration may be partial',
    },
  ]);
});
