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

test('lists the four Steam review tools', () => {
  const toolModule = createToolModule({});

  assert.deepEqual(
    toolModule.tools.map((tool) => tool.name),
    ['search_steam_games', 'get_game_info', 'fetch_reviews', 'analyze_reviews']
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
