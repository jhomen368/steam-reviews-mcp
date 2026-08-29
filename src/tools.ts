import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { analyzeTopicFocused, summarizeReviews } from './utils/analysis.js';
import type {
  FetchReviewsInput,
  GameInfoCriteria,
  PaginatedReviewsResponse,
  Review,
  ReviewStats,
  SteamGame,
} from './types.js';

type ReviewOptions = Partial<FetchReviewsInput> & {
  dayRange?: number;
  filterOfftopicActivity?: boolean;
  steamDeckOnly?: boolean;
};

interface SteamSource {
  searchGames(query: string, limit?: number): Promise<SteamGame[]>;
  getAppDetails(appIds: number | number[]): Promise<SteamGame[]>;
  getReviewSummary(appId: number): Promise<ReviewStats | null>;
  getCurrentPlayers(appId: number): Promise<number>;
  fetchDlcNames(dlcAppIds: number[]): Promise<Map<number, string>>;
  getAppReviews(appId: number, options?: ReviewOptions): Promise<PaginatedReviewsResponse>;
}

const searchTermSchema = z.string().trim().min(1);

const searchGamesSchema = z
  .object({
    query: searchTermSchema.optional(),
    queries: z.array(searchTermSchema).max(5).optional(),
    limit: z.number().min(1).max(25).optional(),
  })
  .refine((data) => data.query || data.queries?.length, {
    message: 'Either query or queries must be provided',
  });

const gameInfoCriteriaSchema = z
  .object({
    minReviewScore: z.number().min(0).max(100).optional(),
    minReviews: z.number().min(0).optional(),
    maxPrice: z.number().min(0).optional(),
    requireFree: z.boolean().optional(),
    requireMetacritic: z.boolean().optional(),
    minMetacritic: z.number().min(0).max(100).optional(),
  })
  .transform((criteria): GameInfoCriteria => ({
    minReviewScore: criteria.minReviewScore || undefined,
    minReviews: criteria.minReviews || undefined,
    maxPrice: criteria.maxPrice || undefined,
    requireFree: criteria.requireFree || undefined,
    requireMetacritic: criteria.requireMetacritic || undefined,
    minMetacritic: criteria.minMetacritic || undefined,
  }));

const getGameInfoSchema = z.object({
  appIds: z.array(z.number()).min(1).max(10),
  includeStats: z.boolean().optional(),
  includeCurrentPlayers: z.boolean().optional(),
  criteria: gameInfoCriteriaSchema.optional(),
  includeRequirements: z.boolean().optional(),
  includeDlc: z.boolean().optional(),
});

const dayRangeSchema = z
  .number()
  .min(0)
  .transform((value) => value || undefined)
  .optional();

const fetchReviewsSchema = z.object({
  appId: z.number(),
  filter: z.enum(['all', 'recent', 'updated']).optional(),
  language: z.string().optional(),
  reviewType: z.enum(['all', 'positive', 'negative']).optional(),
  purchaseType: z.enum(['all', 'steam', 'non_steam_purchase']).optional(),
  limit: z.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
  dayRange: dayRangeSchema,
  filterOfftopicActivity: z.boolean().optional(),
  steamDeckOnly: z.boolean().optional(),
});

const analyzeReviewsSchema = z.object({
  appId: z.number(),
  sampleSize: z.number().min(10).max(200).optional(),
  language: z.string().optional(),
  reviewType: z.enum(['all', 'positive', 'negative']).optional(),
  topic: z.string().optional(),
  dayRange: dayRangeSchema,
  filterOfftopicActivity: z.boolean().optional(),
  steamDeckOnly: z.boolean().optional(),
  preFetchedReviews: z.array(z.any()).optional(),
});

/** Build the human-readable summary returned with game information. */
function generateInfoSummary(game: SteamGame, reviewStats?: ReviewStats | null): string {
  const parts: string[] = [];

  if (reviewStats?.scoreText) {
    const reviewCount = reviewStats.totalReviews.toLocaleString();
    parts.push(`Steam: ${reviewStats.scoreText} (${reviewCount} reviews)`);
  }

  if (game.isFree || game.priceRaw === 0) {
    parts.push('Free to play');
  } else if (game.priceFormatted) {
    parts.push(`Price: ${game.priceFormatted}`);
  }

  const platforms: string[] = [];
  if (game.platforms?.windows) platforms.push('Windows');
  if (game.platforms?.mac) platforms.push('Mac');
  if (game.platforms?.linux) platforms.push('Linux');
  if (platforms.length > 0) {
    parts.push(`Platforms: ${platforms.join(', ')}`);
  }

  if (game.metacriticScore) {
    parts.push(`Metacritic: ${game.metacriticScore}`);
  }

  return parts.join(' | ') || 'No summary available';
}

/** Check whether a game satisfies every requested filter criterion. */
function meetsGameCriteria(
  game: SteamGame & { reviewStats?: ReviewStats | null },
  criteria: GameInfoCriteria
): boolean {
  if (
    criteria.minReviewScore !== undefined &&
    (!game.reviewStats || game.reviewStats.scorePercent < criteria.minReviewScore)
  ) {
    return false;
  }

  if (
    criteria.minReviews !== undefined &&
    (!game.reviewStats || game.reviewStats.totalReviews < criteria.minReviews)
  ) {
    return false;
  }

  if (
    criteria.maxPrice !== undefined &&
    (game.priceRaw === undefined || game.priceRaw > criteria.maxPrice)
  ) {
    return false;
  }

  if (criteria.requireFree === true && !game.isFree) {
    return false;
  }

  if (criteria.requireMetacritic === true && !game.metacriticScore) {
    return false;
  }

  if (
    criteria.minMetacritic !== undefined &&
    (!game.metacriticScore || game.metacriticScore < criteria.minMetacritic)
  ) {
    return false;
  }

  return true;
}

export const tools: Tool[] = [
  {
    name: 'search_steam_games',
    description:
      'Search for Steam games by name or keywords. Provide query for a single search or a non-empty queries array for batch searches. Returns basic game information including AppID, name, price, and preview image.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Non-blank single search query (game name or keywords)',
          minLength: 1,
          pattern: '\\S',
        },
        queries: {
          type: 'array',
          items: { type: 'string', minLength: 1, pattern: '\\S' },
          description:
            'Multiple search queries for batch searching. May be empty when query is provided.',
          maxItems: 5,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results PER QUERY (default: 10, max: 25)',
          minimum: 1,
          maximum: 25,
        },
      },
      anyOf: [
        { required: ['query'] },
        {
          required: ['queries'],
          properties: { queries: { minItems: 1 } },
        },
      ],
    },
  },
  {
    name: 'get_game_info',
    description:
      'Get detailed information about one or more Steam games by AppID. Returns comprehensive game data including description, price, developers, publishers, platforms, metacritic score, review statistics, and optionally system requirements and DLC list. Supports filtering by review quality criteria.',
    inputSchema: {
      type: 'object',
      properties: {
        appIds: {
          type: 'array',
          items: { type: 'number' },
          description: 'Array of Steam AppIDs to fetch information for (supports batch queries)',
          minItems: 1,
          maxItems: 10,
        },
        includeStats: {
          type: 'boolean',
          description: 'Include review statistics (default: true)',
        },
        includeCurrentPlayers: {
          type: 'boolean',
          description: 'Include current player count (default: false)',
        },
        criteria: {
          type: 'object',
          description:
            'Optional filter criteria. Omit when no filtering is needed; zero and false values do not filter results.',
          properties: {
            minReviewScore: {
              type: 'number',
              description: 'Minimum review score percentage (0-100)',
              minimum: 0,
              maximum: 100,
            },
            minReviews: {
              type: 'number',
              description: 'Minimum number of total reviews',
              minimum: 0,
            },
            maxPrice: {
              type: 'number',
              description:
                'Maximum price in cents (e.g., 1999 for $19.99). Use 0 or omit for no maximum.',
              minimum: 0,
            },
            requireFree: {
              type: 'boolean',
              description: 'Only include free games',
            },
            requireMetacritic: {
              type: 'boolean',
              description: 'Only include games with metacritic scores',
            },
            minMetacritic: {
              type: 'number',
              description: 'Minimum metacritic score (0-100)',
              minimum: 0,
              maximum: 100,
            },
          },
        },
        includeRequirements: {
          type: 'boolean',
          description: 'Include system requirements (PC minimum/recommended specs)',
        },
        includeDlc: {
          type: 'boolean',
          description: 'Include list of available DLC',
        },
      },
      required: ['appIds'],
    },
  },
  {
    name: 'fetch_reviews',
    description:
      'Fetch actual user reviews for a Steam game with advanced filtering and pagination support. Returns review text, author info, timestamps, and voting data. Supports time-bounded queries and review bomb filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'number',
          description: 'Steam AppID of the game',
        },
        filter: {
          type: 'string',
          enum: ['all', 'recent', 'updated'],
          description: 'Review filter (default: all)',
        },
        language: {
          type: 'string',
          description: 'Language code (e.g., "english", "schinese", Steam format)',
        },
        reviewType: {
          type: 'string',
          enum: ['all', 'positive', 'negative'],
          description: 'Filter by review sentiment (default: all)',
        },
        purchaseType: {
          type: 'string',
          enum: ['all', 'steam', 'non_steam_purchase'],
          description: 'Filter by purchase type (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Number of reviews to fetch (default: 20, max: 100)',
          minimum: 1,
          maximum: 100,
        },
        cursor: {
          type: 'string',
          description:
            'Pagination cursor from previous response. Omit or use an empty string for the first page.',
        },
        dayRange: {
          type: 'number',
          description:
            'Only include reviews from the last N days (e.g., 30, 90, 365). Omit or use 0 for all time.',
          minimum: 0,
        },
        filterOfftopicActivity: {
          type: 'boolean',
          description:
            'Filter out review bombing and off-topic activity (default: false to show all reviews)',
        },
        steamDeckOnly: {
          type: 'boolean',
          description: 'Only include Steam Deck reviews (experimental, may not work reliably)',
        },
      },
      required: ['appId'],
    },
  },
  {
    name: 'analyze_reviews',
    description:
      'Fetch and analyze Steam game reviews to extract sentiment, common themes, and key insights. Supports optional topic drill-down, time-bounded analysis, and pre-fetched reviews.',
    inputSchema: {
      type: 'object',
      properties: {
        appId: {
          type: 'number',
          description: 'Steam AppID of the game to analyze',
        },
        sampleSize: {
          type: 'number',
          description: 'Number of reviews to analyze (default: 100, max: 200)',
          minimum: 10,
          maximum: 200,
        },
        language: {
          type: 'string',
          description: 'Filter reviews by language (e.g., "english", "schinese")',
        },
        reviewType: {
          type: 'string',
          enum: ['all', 'positive', 'negative'],
          description: 'Filter by review sentiment (default: all)',
        },
        topic: {
          type: 'string',
          description:
            'Optional: Drill down into specific theme (e.g., "performance", "multiplayer")',
        },
        dayRange: {
          type: 'number',
          description:
            'Only analyze reviews from the last N days (e.g., 30, 90, 365). Omit or use 0 for all time.',
          minimum: 0,
        },
        filterOfftopicActivity: {
          type: 'boolean',
          description:
            'Filter out review bombing (default: false to show all reviews including controversies)',
        },
        steamDeckOnly: {
          type: 'boolean',
          description: 'Only analyze Steam Deck reviews (experimental)',
        },
        preFetchedReviews: {
          type: 'array',
          items: {
            type: 'object',
            description: 'Review object from fetch_reviews tool',
          },
          description:
            'Optional: Non-empty array of pre-fetched reviews to analyze instead of fetching new ones. Useful to avoid duplicate API calls. When non-empty, sampleSize, language, reviewType, dayRange, and filtering parameters are ignored.',
        },
      },
      required: ['appId'],
    },
  },
];

/** Create the transport-neutral Steam review tool module. */
export function createToolModule(steamClient: SteamSource) {
  /** Execute a game search. */
  async function executeSearchGames(args: unknown) {
    const validatedInput = searchGamesSchema.parse(args);
    let results: SteamGame[];

    if (validatedInput.queries?.length) {
      const allResults = await Promise.all(
        validatedInput.queries.map((query) => steamClient.searchGames(query, validatedInput.limit))
      );
      results = allResults.flat();
    } else {
      results = await steamClient.searchGames(validatedInput.query!, validatedInput.limit);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(results, null, 2),
        },
      ],
    };
  }

  /** Execute game information retrieval and enrichment. */
  async function executeGetGameInfo(args: unknown) {
    const validatedInput = getGameInfoSchema.parse(args);
    const games = await steamClient.getAppDetails(validatedInput.appIds);
    const hasCriteria = Object.values(validatedInput.criteria ?? {}).some(
      (value) => value !== undefined
    );
    const includeStats = validatedInput.includeStats !== false || hasCriteria;
    const reviewSummaries = new Map<number, ReviewStats | null>();

    if (includeStats) {
      await Promise.all(
        games.map(async (game) => {
          try {
            const stats = await steamClient.getReviewSummary(game.appId);
            reviewSummaries.set(game.appId, stats);
          } catch (error) {
            console.error(`Failed to get review summary for ${game.appId}:`, error);
            reviewSummaries.set(game.appId, null);
          }
        })
      );
    }

    if (validatedInput.includeCurrentPlayers ?? false) {
      await Promise.all(
        games.map(async (game) => {
          try {
            game.currentPlayers = await steamClient.getCurrentPlayers(game.appId);
          } catch (error) {
            console.error(`Failed to get current players for ${game.appId}:`, error);
          }
        })
      );
    }

    const gamesWithStats = games.map((game) => ({
      ...game,
      reviewStats: includeStats ? reviewSummaries.get(game.appId) : undefined,
    }));

    if (validatedInput.includeDlc) {
      const allDlcAppIds: number[] = [];
      for (const game of gamesWithStats) {
        if (game.dlc && game.dlc.length > 0) {
          for (const dlc of game.dlc) {
            if (dlc.appId) {
              allDlcAppIds.push(dlc.appId);
            }
          }
        }
      }

      if (allDlcAppIds.length > 0) {
        const dlcNames = await steamClient.fetchDlcNames(allDlcAppIds);
        for (const game of gamesWithStats) {
          if (game.dlc && game.dlc.length > 0) {
            for (const dlc of game.dlc) {
              const name = dlcNames.get(dlc.appId);
              if (name) {
                dlc.name = name;
              }
            }
          }
        }
      }
    }

    const processedGames = gamesWithStats.map((game) => {
      const processed = { ...game };

      if (!validatedInput.includeRequirements) {
        delete processed.systemRequirements;
      }

      if (!validatedInput.includeDlc) {
        delete processed.dlc;
      }

      return processed;
    });

    let filteredGames = processedGames;
    if (hasCriteria && validatedInput.criteria) {
      filteredGames = processedGames.filter((game) =>
        meetsGameCriteria(game, validatedInput.criteria!)
      );
    }

    const enrichedGames = filteredGames.map((game) => ({
      ...game,
      infoSummary: generateInfoSummary(game, game.reviewStats ?? null),
    }));

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(enrichedGames, null, 2),
        },
      ],
    };
  }

  /** Execute paginated review retrieval. */
  async function executeFetchReviews(args: unknown) {
    const validatedInput = fetchReviewsSchema.parse(args);
    const result = await steamClient.getAppReviews(validatedInput.appId, {
      filter: validatedInput.filter,
      language: validatedInput.language,
      reviewType: validatedInput.reviewType,
      purchaseType: validatedInput.purchaseType,
      limit: validatedInput.limit,
      cursor: validatedInput.cursor,
      dayRange: validatedInput.dayRange,
      filterOfftopicActivity: validatedInput.filterOfftopicActivity,
      steamDeckOnly: validatedInput.steamDeckOnly,
    });

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  /** Execute review analysis from supplied or fetched reviews. */
  async function executeAnalyzeReviews(args: unknown) {
    const validatedInput = analyzeReviewsSchema.parse(args);
    let allReviews: Review[];

    if (validatedInput.preFetchedReviews && validatedInput.preFetchedReviews.length > 0) {
      allReviews = validatedInput.preFetchedReviews as Review[];
    } else {
      const sampleSize = validatedInput.sampleSize || 100;
      const reviewsResponse = await steamClient.getAppReviews(validatedInput.appId, {
        language: validatedInput.language,
        reviewType: validatedInput.reviewType,
        limit: Math.min(sampleSize, 100),
        dayRange: validatedInput.dayRange,
        filterOfftopicActivity: validatedInput.filterOfftopicActivity,
        steamDeckOnly: validatedInput.steamDeckOnly,
      });

      allReviews = reviewsResponse.reviews;

      if (sampleSize > 100 && reviewsResponse.cursor) {
        const remaining = sampleSize - allReviews.length;
        const secondPageSize = Math.min(remaining, 100);
        const page2 = await steamClient.getAppReviews(validatedInput.appId, {
          language: validatedInput.language,
          reviewType: validatedInput.reviewType,
          limit: secondPageSize,
          cursor: reviewsResponse.cursor,
          dayRange: validatedInput.dayRange,
          filterOfftopicActivity: validatedInput.filterOfftopicActivity,
          steamDeckOnly: validatedInput.steamDeckOnly,
        });

        allReviews = [...allReviews, ...page2.reviews];
      }
    }

    if (allReviews.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: 'No reviews found',
                details: 'No reviews were found for the specified game and filters.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const analysis = validatedInput.topic
      ? analyzeTopicFocused(allReviews, validatedInput.topic, validatedInput.appId)
      : summarizeReviews(allReviews, validatedInput.appId);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(analysis, null, 2),
        },
      ],
    };
  }

  /** Dispatch a validated tool name to its implementation. */
  async function executeTool(name: string, args: unknown) {
    if (name === 'search_steam_games') return executeSearchGames(args);
    if (name === 'get_game_info') return executeGetGameInfo(args);
    if (name === 'fetch_reviews') return executeFetchReviews(args);
    if (name === 'analyze_reviews') return executeAnalyzeReviews(args);
    throw new Error(`Unknown tool: ${name}`);
  }

  /** Execute a tool and map failures to MCP error results. */
  async function execute(name: string, args: unknown) {
    try {
      return await executeTool(name, args);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        console.error(`Validation error in tool ${name}:`, errorMessages);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: true,
                  message: 'Validation error',
                  details: errorMessages,
                  tool: name,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error in tool ${name}:`, errorMessage);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                error: true,
                message: errorMessage,
                tool: name,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }

  return { tools, execute };
}
