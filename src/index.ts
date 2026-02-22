#!/usr/bin/env node

/**
 * Steam Reviews MCP Server
 *
 * Provides AI agents access to Steam game review data and analysis.
 * This server implements the Model Context Protocol (MCP) for seamless
 * integration with AI assistants like Claude.
 *
 * @module steam-reviews-mcp
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SteamAPIClient } from './utils/steam-api.js';
import { config } from './config.js';
import { summarizeReviews, analyzeTopicFocused } from './utils/analysis.js';
import type { SteamGame, ReviewStats, GameInfoCriteria } from './types.js';

/**
 * Tool definitions for the MCP server.
 * Each tool has a name, description, and input schema.
 */
const tools: Tool[] = [
  {
    name: 'search_steam_games',
    description:
      'Search for Steam games by name or keywords. Supports single or batch queries. Returns basic game information including AppID, name, price, and preview image.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Single search query (game name or keywords)',
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple search queries for batch searching',
          minItems: 1,
          maxItems: 5,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results PER QUERY (default: 10, max: 25)',
          minimum: 1,
          maximum: 25,
        },
      },
      // Note: Either query OR queries must be provided (validated in Zod)
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
            'Optional filter criteria - only games matching ALL criteria will be returned',
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
              description: 'Maximum price in cents (e.g., 1999 for $19.99)',
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
          description: 'Pagination cursor from previous response',
        },
        dayRange: {
          type: 'number',
          description: 'Only include reviews from last N days (e.g., 30, 90, 365)',
          minimum: 1,
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
          description: 'Only analyze reviews from last N days (e.g., 30, 90, 365)',
          minimum: 1,
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
            'Optional: Pre-fetched reviews to analyze instead of fetching new ones. Useful to avoid duplicate API calls. If provided, sampleSize, language, reviewType, dayRange, and filtering parameters are ignored.',
        },
      },
      required: ['appId'],
    },
  },
];

/**
 * Zod schema for validating search_steam_games input.
 * Supports both single query and batch queries.
 */
const searchGamesSchema = z
  .object({
    query: z.string().optional(),
    queries: z.array(z.string()).min(1).max(5).optional(),
    limit: z.number().min(1).max(25).optional(),
  })
  .refine((data) => data.query || data.queries, {
    message: 'Either query or queries must be provided',
  });

/**
 * Zod schema for validating game info criteria.
 */
const gameInfoCriteriaSchema = z.object({
  minReviewScore: z.number().min(0).max(100).optional(),
  minReviews: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  requireFree: z.boolean().optional(),
  requireMetacritic: z.boolean().optional(),
  minMetacritic: z.number().min(0).max(100).optional(),
});

/**
 * Zod schema for validating get_game_info input.
 */
const getGameInfoSchema = z.object({
  appIds: z.array(z.number()).min(1).max(10),
  includeStats: z.boolean().optional(),
  includeCurrentPlayers: z.boolean().optional(),
  criteria: gameInfoCriteriaSchema.optional(),
  includeRequirements: z.boolean().optional(),
  includeDlc: z.boolean().optional(),
});

/**
 * Zod schema for validating fetch_reviews input.
 */
const fetchReviewsSchema = z.object({
  appId: z.number(),
  filter: z.enum(['all', 'recent', 'updated']).optional(),
  language: z.string().optional(),
  reviewType: z.enum(['all', 'positive', 'negative']).optional(),
  purchaseType: z.enum(['all', 'steam', 'non_steam_purchase']).optional(),
  limit: z.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
  dayRange: z.number().min(1).optional(),
  filterOfftopicActivity: z.boolean().optional(),
  steamDeckOnly: z.boolean().optional(),
});

/**
 * Zod schema for validating analyze_reviews input.
 */
const analyzeReviewsSchema = z.object({
  appId: z.number(),
  sampleSize: z.number().min(10).max(200).optional(),
  language: z.string().optional(),
  reviewType: z.enum(['all', 'positive', 'negative']).optional(),
  topic: z.string().optional(),
  dayRange: z.number().min(1).optional(),
  filterOfftopicActivity: z.boolean().optional(),
  steamDeckOnly: z.boolean().optional(),
  preFetchedReviews: z.array(z.any()).optional(), // z.any() since Review type is complex
});

/**
 * Generate an informational summary based on game data.
 *
 * Provides a quick overview combining Steam user reviews, price,
 * platform availability, and critic scores.
 *
 * @param game - Steam game data to analyze
 * @param reviewStats - Optional Steam user review statistics
 * @returns A human-readable informational summary string
 */
function generateInfoSummary(game: SteamGame, reviewStats?: ReviewStats | null): string {
  const parts: string[] = [];

  // Steam user review classification (primary info)
  if (reviewStats?.scoreText) {
    const reviewCount = reviewStats.totalReviews.toLocaleString();
    parts.push(`Steam: ${reviewStats.scoreText} (${reviewCount} reviews)`);
  }

  // Price information
  if (game.isFree || game.priceRaw === 0) {
    parts.push('Free to play');
  } else if (game.priceFormatted) {
    parts.push(`Price: ${game.priceFormatted}`);
  }

  // Platform availability
  const platforms: string[] = [];
  if (game.platforms?.windows) platforms.push('Windows');
  if (game.platforms?.mac) platforms.push('Mac');
  if (game.platforms?.linux) platforms.push('Linux');
  if (platforms.length > 0) {
    parts.push(`Platforms: ${platforms.join(', ')}`);
  }

  // Metacritic score (raw value)
  if (game.metacriticScore) {
    parts.push(`Metacritic: ${game.metacriticScore}`);
  }

  return parts.join(' | ') || 'No summary available';
}

/**
 * Check if a game meets the specified criteria.
 *
 * All criteria are AND conditions - the game must meet ALL specified criteria.
 *
 * @param game - Steam game data with optional review stats
 * @param criteria - Filter criteria to check against
 * @returns True if the game meets all criteria, false otherwise
 */
function meetsGameCriteria(
  game: SteamGame & { reviewStats?: ReviewStats | null },
  criteria: GameInfoCriteria
): boolean {
  // Check min review score
  if (criteria.minReviewScore !== undefined) {
    if (!game.reviewStats || game.reviewStats.scorePercent < criteria.minReviewScore) {
      return false;
    }
  }

  // Check min reviews
  if (criteria.minReviews !== undefined) {
    if (!game.reviewStats || game.reviewStats.totalReviews < criteria.minReviews) {
      return false;
    }
  }

  // Check max price
  if (criteria.maxPrice !== undefined) {
    if (game.priceRaw === undefined || game.priceRaw > criteria.maxPrice) {
      return false;
    }
  }

  // Check require free
  if (criteria.requireFree === true) {
    if (!game.isFree) {
      return false;
    }
  }

  // Check require metacritic
  if (criteria.requireMetacritic === true) {
    if (!game.metacriticScore) {
      return false;
    }
  }

  // Check min metacritic
  if (criteria.minMetacritic !== undefined) {
    if (!game.metacriticScore || game.metacriticScore < criteria.minMetacritic) {
      return false;
    }
  }

  return true;
}

/**
 * Main entry point for the Steam Reviews MCP Server.
 *
 * Initializes the Steam API client, creates the MCP server,
 * registers tool handlers, and connects to the stdio transport.
 */
async function main() {
  // Initialize Steam API client with configuration
  const steamClient = new SteamAPIClient(config);

  // Create MCP server instance
  const server = new Server(
    {
      name: 'steam-reviews-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  /**
   * Handler for list_tools request.
   * Returns the list of available tools.
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  /**
   * Handler for call_tool request.
   * Routes tool calls to the appropriate handler based on tool name.
   */
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === 'search_steam_games') {
        // Validate input using Zod schema
        const validatedInput = searchGamesSchema.parse(args);

        let results: SteamGame[];

        if (validatedInput.queries) {
          // Batch search - execute all queries in parallel
          const allResults = await Promise.all(
            validatedInput.queries.map((q) => steamClient.searchGames(q, validatedInput.limit))
          );
          // Flatten results from all queries
          results = allResults.flat();
        } else {
          // Single search
          results = await steamClient.searchGames(validatedInput.query!, validatedInput.limit);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } else if (name === 'get_game_info') {
        const validatedInput = getGameInfoSchema.parse(args);

        // Fetch game details
        const games = await steamClient.getAppDetails(validatedInput.appIds);

        // Determine if we need review stats (default: include, or required for criteria)
        const hasCriteria = validatedInput.criteria !== undefined;
        const includeStats = validatedInput.includeStats !== false || hasCriteria;
        const reviewSummaries = new Map<number, ReviewStats | null>();

        if (includeStats) {
          await Promise.all(
            games.map(async (game) => {
              try {
                const stats = await steamClient.getReviewSummary(game.appId);
                reviewSummaries.set(game.appId, stats);
              } catch (error) {
                // Silently fail for review stats (not critical)
                console.error(`Failed to get review summary for ${game.appId}:`, error);
                reviewSummaries.set(game.appId, null);
              }
            })
          );
        }

        // Optionally include current players
        if (validatedInput.includeCurrentPlayers ?? false) {
          await Promise.all(
            games.map(async (game) => {
              try {
                game.currentPlayers = await steamClient.getCurrentPlayers(game.appId);
              } catch (error) {
                // Silently fail for current players (not critical)
                console.error(`Failed to get current players for ${game.appId}:`, error);
              }
            })
          );
        }

        // Build enriched games with review stats attached
        const gamesWithStats = games.map((game) => {
          const reviewStats = reviewSummaries.get(game.appId);
          return {
            ...game,
            reviewStats: includeStats ? reviewStats : undefined,
          };
        });

        // Strip out optional fields if not requested
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

        // Filter by criteria if provided
        let filteredGames = processedGames;
        if (validatedInput.criteria) {
          filteredGames = processedGames.filter((game) =>
            meetsGameCriteria(game, validatedInput.criteria!)
          );
        }

        // Generate info summaries for filtered results
        const enrichedGames = filteredGames.map((game) => ({
          ...game,
          infoSummary: generateInfoSummary(game, game.reviewStats ?? null),
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(enrichedGames, null, 2),
            },
          ],
        };
      } else if (name === 'fetch_reviews') {
        const validatedInput = fetchReviewsSchema.parse(args);

        // Fetch reviews using SteamAPIClient
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
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } else if (name === 'analyze_reviews') {
        const validatedInput = analyzeReviewsSchema.parse(args);

        let allReviews: import('./types.js').Review[];

        if (validatedInput.preFetchedReviews && validatedInput.preFetchedReviews.length > 0) {
          // Use pre-fetched reviews (type assertion)
          allReviews = validatedInput.preFetchedReviews as import('./types.js').Review[];
        } else {
          // Fetch reviews as before
          const sampleSize = validatedInput.sampleSize || 100;

          // Fetch reviews for analysis
          const reviewsResponse = await steamClient.getAppReviews(validatedInput.appId, {
            language: validatedInput.language,
            reviewType: validatedInput.reviewType,
            limit: Math.min(sampleSize, 100), // Steam API max per page
            dayRange: validatedInput.dayRange,
            filterOfftopicActivity: validatedInput.filterOfftopicActivity,
            steamDeckOnly: validatedInput.steamDeckOnly,
          });

          allReviews = reviewsResponse.reviews;

          // Fetch additional pages if needed to reach sample size
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

        // Handle case where no reviews were found
        if (allReviews.length === 0) {
          return {
            content: [
              {
                type: 'text',
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

        // Analyze reviews - use topic-focused analysis if topic provided
        // Pass appId to enable example quotes with clickable Steam community links
        let analysis;
        if (validatedInput.topic) {
          analysis = analyzeTopicFocused(allReviews, validatedInput.topic, validatedInput.appId);
        } else {
          analysis = summarizeReviews(allReviews, validatedInput.appId);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(analysis, null, 2),
            },
          ],
        };
      }

      // Unknown tool requested
      throw new Error(`Unknown tool: ${name}`);
    } catch (error) {
      // Handle Zod validation errors
      if (error instanceof z.ZodError) {
        const errorMessages = error.issues
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; ');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Validation error',
                  details: errorMessages,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // Handle other errors
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: 'Tool execution failed',
                details: errorMessage,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });

  // Connect server to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is used for MCP communication)
  console.error('Steam Reviews MCP Server running on stdio');
}

// Start the server
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
