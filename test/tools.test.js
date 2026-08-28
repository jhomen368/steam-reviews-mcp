import assert from 'node:assert/strict';
import test from 'node:test';

import { createToolModule } from '../build/tools.js';

test('lists the four Steam review tools', () => {
  const toolModule = createToolModule({});

  assert.deepEqual(
    toolModule.tools.map((tool) => tool.name),
    ['search_steam_games', 'get_game_info', 'fetch_reviews', 'analyze_reviews']
  );
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

test('analyzes pre-fetched reviews', async () => {
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
