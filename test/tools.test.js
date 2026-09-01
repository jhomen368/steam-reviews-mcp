import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolModule } from '../build/tools.js';

const review = {
  recommendationId: '123',
  author: {
    steamId: '456',
    playtimeForever: 120,
    playtimeAtReview: 60,
  },
  language: 'english',
  review: 'Excellent portal puzzles',
  timestampCreated: 1,
  timestampUpdated: 1,
  votedUp: true,
  votesUp: 5,
  votesFunny: 0,
  votesHelpful: 5,
  commentCount: 0,
  steamPurchase: true,
  receivedForFree: false,
  writtenDuringEarlyAccess: false,
};

const noDeckResult = {
  source: 'valve_steam_deck_compatibility',
  category: 'unknown',
  categoryCode: null,
  testResults: [],
};

test('lists the Steam research tools', () => {
  const toolModule = createToolModule({});

  assert.deepEqual(
    toolModule.tools.map((tool) => tool.name),
    [
      'search_steam_games',
      'get_game_info',
      'fetch_reviews',
      'analyze_reviews',
      'fetch_app_announcements',
    ]
  );
});

test('publishes the single-or-batch search requirement', () => {
  const searchTool = createToolModule({}).tools.find((tool) => tool.name === 'search_steam_games');

  assert.deepEqual(searchTool.inputSchema.anyOf, [
    { required: ['query'] },
    {
      required: ['queries'],
      properties: { queries: { minItems: 1 } },
    },
  ]);
});

test('searches for a single Steam game', async () => {
  const toolModule = createToolModule({
    async searchGames(query, limit) {
      return [{ appId: 620, name: `${query}:${limit}` }];
    },
  });

  const result = await toolModule.execute('search_steam_games', {
    query: 'Portal 2',
    limit: 1,
  });

  assert.deepEqual(result, {
    content: [
      {
        type: 'text',
        text: '[\n  {\n    "appId": 620,\n    "name": "Portal 2:1"\n  }\n]',
      },
    ],
  });
});

test('ignores an empty batch query when a single query is provided', async () => {
  const toolModule = createToolModule({
    async searchGames(query, limit) {
      return [{ appId: 620, name: `${query}:${limit}` }];
    },
  });

  const result = await toolModule.execute('search_steam_games', {
    query: 'Portal 2',
    queries: [],
    limit: 1,
  });

  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), [{ appId: 620, name: 'Portal 2:1' }]);
});

test('rejects empty and blank search inputs', async () => {
  const toolModule = createToolModule({});

  for (const input of [{ queries: [] }, { query: '   ' }, { queries: ['   '] }]) {
    const result = await toolModule.execute('search_steam_games', input);
    assert.equal(result.isError, true);
  }
});

test('returns processed game information', async () => {
  const toolModule = createToolModule({
    async getAppDetails() {
      return [
        {
          appId: 620,
          name: 'Portal 2',
          isFree: true,
          platforms: { windows: true, mac: false, linux: true },
          systemRequirements: { minimum: 'test minimum' },
          dlc: [{ appId: 201790, name: 'unused' }],
        },
      ];
    },
    async getDeckCompatibility() {
      return {
        source: 'valve_steam_deck_compatibility',
        category: 'verified',
        categoryCode: 3,
        testResults: [
          {
            displayType: 4,
            token: '#SteamDeckVerified_TestResult_DefaultControllerConfigFullyFunctional',
          },
        ],
      };
    },
  });

  const result = await toolModule.execute('get_game_info', {
    appIds: [620],
    includeStats: false,
  });

  assert.deepEqual(JSON.parse(result.content[0].text), [
    {
      appId: 620,
      name: 'Portal 2',
      isFree: true,
      platforms: { windows: true, mac: false, linux: true },
      deckCompatibility: {
        source: 'valve_steam_deck_compatibility',
        category: 'verified',
        categoryCode: 3,
        testResults: [
          {
            displayType: 4,
            token: '#SteamDeckVerified_TestResult_DefaultControllerConfigFullyFunctional',
          },
        ],
      },
      infoSummary: 'Free to play | Platforms: Windows, Linux',
    },
  ]);
});

test('treats an all-default criteria object as no game filter', async () => {
  const toolModule = createToolModule({
    async getAppDetails() {
      return [{ appId: 620, name: 'Portal 2', isFree: false, priceRaw: 999 }];
    },
    async getReviewSummary() {
      return {
        totalReviews: 100,
        totalPositive: 90,
        totalNegative: 10,
        scorePercent: 90,
        scoreText: 'Very Positive',
      };
    },
    async getDeckCompatibility() {
      return noDeckResult;
    },
  });

  const result = await toolModule.execute('get_game_info', {
    appIds: [620],
    includeStats: true,
    criteria: {
      minReviewScore: 0,
      minReviews: 0,
      maxPrice: 0,
      requireFree: false,
      requireMetacritic: false,
      minMetacritic: 0,
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(JSON.parse(result.content[0].text)[0].appId, 620);
});

test('applies positive and true game criteria', async () => {
  const toolModule = createToolModule({
    async getAppDetails() {
      return [
        {
          appId: 620,
          name: 'Portal 2',
          isFree: false,
          priceRaw: 999,
          metacriticScore: 90,
        },
        { appId: 730, name: 'Counter-Strike 2', isFree: true, priceRaw: 0 },
      ];
    },
    async getReviewSummary(appId) {
      const scorePercent = appId === 620 ? 90 : 80;
      const totalReviews = appId === 620 ? 100 : 50;
      const totalPositive = (totalReviews * scorePercent) / 100;
      return {
        totalReviews,
        totalPositive,
        totalNegative: totalReviews - totalPositive,
        scorePercent,
        scoreText: 'Positive',
      };
    },
    async getDeckCompatibility() {
      return noDeckResult;
    },
  });

  const appIdsFor = async (criteria) => {
    const result = await toolModule.execute('get_game_info', {
      appIds: [620, 730],
      criteria,
    });
    return JSON.parse(result.content[0].text).map((game) => game.appId);
  };

  assert.deepEqual(await appIdsFor({ minReviewScore: 85 }), [620]);
  assert.deepEqual(await appIdsFor({ minReviews: 75 }), [620]);
  assert.deepEqual(await appIdsFor({ maxPrice: 500 }), [730]);
  assert.deepEqual(await appIdsFor({ requireFree: true }), [730]);
  assert.deepEqual(await appIdsFor({ requireMetacritic: true }), [620]);
  assert.deepEqual(await appIdsFor({ minMetacritic: 85 }), [620]);
});

test('keeps base game information when Steam Deck evidence is unavailable', async () => {
  const toolModule = createToolModule({
    async getAppDetails() {
      return [
        { appId: 620, name: 'Portal 2' },
        { appId: 730, name: 'Counter-Strike 2' },
      ];
    },
    async getDeckCompatibility(appId) {
      if (appId === 730) throw new Error('Malformed Steam Deck response');
      return noDeckResult;
    },
  });

  const result = await toolModule.execute('get_game_info', {
    appIds: [620, 730],
    includeStats: false,
  });
  const games = JSON.parse(result.content[0].text);

  assert.equal(result.isError, undefined);
  assert.deepEqual(games[0].deckCompatibility, noDeckResult);
  assert.equal(games[0].warnings, undefined);
  assert.equal(games[1].name, 'Counter-Strike 2');
  assert.equal(games[1].deckCompatibility, undefined);
  assert.deepEqual(games[1].warnings, [
    {
      source: 'steam_deck_compatibility',
      message: 'Steam Deck compatibility is unavailable for AppID 730',
    },
  ]);
});

test('fetches reviews with the requested filters', async () => {
  const toolModule = createToolModule({
    async getAppReviews(appId, options) {
      return {
        reviews: [],
        cursor: `${appId}:${options.language}:${options.limit}`,
        totalReviews: 0,
      };
    },
  });

  const result = await toolModule.execute('fetch_reviews', {
    appId: 620,
    language: 'english',
    limit: 25,
  });

  assert.deepEqual(JSON.parse(result.content[0].text), {
    reviews: [],
    cursor: '620:english:25',
    totalReviews: 0,
  });
});

test('fetches official app announcements with backward pagination', async () => {
  let received;
  const toolModule = createToolModule({
    async getAppAnnouncements(appId, options) {
      received = { appId, options };
      return {
        appId,
        source: 'official_app_announcements',
        announcements: [],
        nextCursor: null,
      };
    },
  });

  const result = await toolModule.execute('fetch_app_announcements', {
    appId: 620,
    limit: 5,
    cursor: 'opaque-cursor',
  });

  assert.deepEqual(received, {
    appId: 620,
    options: { limit: 5, cursor: 'opaque-cursor' },
  });
  assert.deepEqual(JSON.parse(result.content[0].text), {
    appId: 620,
    source: 'official_app_announcements',
    announcements: [],
    nextCursor: null,
  });
});

test('keeps an empty announcement feed distinct from a Steam failure', async () => {
  const emptyModule = createToolModule({
    async getAppAnnouncements(appId) {
      return {
        appId,
        source: 'official_app_announcements',
        announcements: [],
        nextCursor: null,
      };
    },
  });
  const failingModule = createToolModule({
    async getAppAnnouncements() {
      throw new Error('Steam news unavailable');
    },
  });

  const emptyResult = await emptyModule.execute('fetch_app_announcements', { appId: 620 });
  const failureResult = await failingModule.execute('fetch_app_announcements', { appId: 620 });

  assert.equal(emptyResult.isError, undefined);
  assert.deepEqual(JSON.parse(emptyResult.content[0].text).announcements, []);
  assert.equal(failureResult.isError, true);
  assert.equal(JSON.parse(failureResult.content[0].text).message, 'Steam news unavailable');
});

test('rejects invalid official announcement inputs before requesting Steam', async () => {
  let requestCount = 0;
  const toolModule = createToolModule({
    async getAppAnnouncements() {
      requestCount += 1;
    },
  });

  for (const input of [
    { appId: 0 },
    { appId: 620, limit: 0 },
    { appId: 620, limit: 101 },
    { appId: 620, cursor: '' },
  ]) {
    const result = await toolModule.execute('fetch_app_announcements', input);
    assert.equal(result.isError, true);
  }
  assert.equal(requestCount, 0);
});

test('treats dayRange zero as an all-time review query', async () => {
  let receivedOptions;
  const toolModule = createToolModule({
    async getAppReviews(_appId, options) {
      receivedOptions = options;
      return { reviews: [], cursor: null, hasMore: false, totalFetched: 0 };
    },
  });

  const result = await toolModule.execute('fetch_reviews', {
    appId: 620,
    dayRange: 0,
  });

  assert.equal(result.isError, undefined);
  assert.equal(receivedOptions.dayRange, undefined);
});

test('treats dayRange zero as all time when fetching reviews for analysis', async () => {
  let receivedOptions;
  const toolModule = createToolModule({
    async getAppReviews(_appId, options) {
      receivedOptions = options;
      return { reviews: [review], cursor: null, hasMore: false, totalFetched: 1 };
    },
  });

  const result = await toolModule.execute('analyze_reviews', {
    appId: 620,
    dayRange: 0,
  });

  assert.equal(result.isError, undefined);
  assert.equal(receivedOptions.dayRange, undefined);
});

test('analyzes pre-fetched reviews', async () => {
  const toolModule = createToolModule({});

  const result = await toolModule.execute('analyze_reviews', {
    appId: 620,
    preFetchedReviews: [review],
  });
  const analysis = JSON.parse(result.content[0].text);

  assert.deepEqual(
    {
      totalAnalyzed: analysis.totalAnalyzed,
      sampleSize: analysis.sampleSize,
      quoteUrl: analysis.exampleQuotes[0].url,
    },
    {
      totalAnalyzed: 1,
      sampleSize: 1,
      quoteUrl: 'https://steamcommunity.com/profiles/456/recommended/620/',
    }
  );
});

test('returns an MCP error result for invalid tool input', async () => {
  const toolModule = createToolModule({});

  const result = await toolModule.execute('search_steam_games', {});

  assert.deepEqual(
    {
      isError: result.isError,
      error: JSON.parse(result.content[0].text),
    },
    {
      isError: true,
      error: {
        error: true,
        message: 'Validation error',
        details: ': Either query or queries must be provided',
        tool: 'search_steam_games',
      },
    }
  );
});

test('returns an MCP error result for an unknown tool', async () => {
  const toolModule = createToolModule({});

  const result = await toolModule.execute('missing_tool', {});

  assert.deepEqual(
    {
      isError: result.isError,
      error: JSON.parse(result.content[0].text),
    },
    {
      isError: true,
      error: {
        error: true,
        message: 'Unknown tool: missing_tool',
        tool: 'missing_tool',
      },
    }
  );
});

test('returns an MCP error result when Steam fails', async () => {
  const toolModule = createToolModule({
    async searchGames() {
      throw new Error('Steam unavailable');
    },
  });

  const result = await toolModule.execute('search_steam_games', { query: 'Portal 2' });

  assert.deepEqual(
    {
      isError: result.isError,
      error: JSON.parse(result.content[0].text),
    },
    {
      isError: true,
      error: {
        error: true,
        message: 'Steam unavailable',
        tool: 'search_steam_games',
      },
    }
  );
});
