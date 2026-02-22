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
import type { SearchGamesInput, SteamGame, ReviewStats } from './types.js';

/**
 * Tool definitions for the MCP server.
 * Each tool has a name, description, and input schema.
 */
const tools: Tool[] = [
  {
    name: 'search_steam_games',
    description:
      'Search for Steam games by name or keywords. Returns basic game information including AppID, name, price, and preview image.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (game name or keywords)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10, max: 25)',
          minimum: 1,
          maximum: 25,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_game_info',
    description:
      'Get detailed information about one or more Steam games by AppID. Returns comprehensive game data including description, price, developers, publishers, platforms, metacritic score, review statistics, and an informational summary.',
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
      },
      required: ['appIds'],
    },
  },
  {
    name: 'fetch_reviews',
    description:
      'Fetch actual user reviews for a Steam game with filtering and pagination support. Returns review text, author info, timestamps, and voting data. Use this to get raw review content for analysis.',
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
      },
      required: ['appId'],
    },
  },
  {
    name: 'analyze_reviews',
    description:
      'Fetch and analyze Steam game reviews to extract sentiment, common themes, and key insights. Supports optional topic drill-down to focus analysis on specific aspects like "performance", "multiplayer", "graphics", etc.',
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
            'Optional: Drill down into specific theme or aspect (e.g., "performance", "multiplayer", "graphics", "bugs"). Only reviews mentioning this topic will be analyzed.',
        },
      },
      required: ['appId'],
    },
  },
];

/**
 * Zod schema for validating search_steam_games input.
 */
const searchGamesSchema = z.object({
  query: z.string().min(1, 'Query cannot be empty'),
  limit: z.number().min(1).max(25).optional(),
});

/**
 * Zod schema for validating get_game_info input.
 */
const getGameInfoSchema = z.object({
  appIds: z.array(z.number()).min(1).max(10),
  includeStats: z.boolean().optional(),
  includeCurrentPlayers: z.boolean().optional(),
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
        const validatedInput = searchGamesSchema.parse(args) as SearchGamesInput;

        // Call Steam API client to search for games
        const results = await steamClient.searchGames(
          validatedInput.query,
          validatedInput.limit ?? 10
        );

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

        // Fetch review summaries for all games (default: include stats)
        const includeStats = validatedInput.includeStats !== false;
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

        // Add info summary and review stats
        const enrichedGames = games.map((game) => {
          const reviewStats = reviewSummaries.get(game.appId);
          return {
            ...game,
            reviewStats: includeStats ? reviewStats : undefined,
            infoSummary: generateInfoSummary(game, reviewStats),
          };
        });

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

        const sampleSize = validatedInput.sampleSize || 100;

        // Fetch reviews for analysis
        const reviewsResponse = await steamClient.getAppReviews(validatedInput.appId, {
          language: validatedInput.language,
          reviewType: validatedInput.reviewType,
          limit: Math.min(sampleSize, 100), // Steam API max per page
        });

        let allReviews = reviewsResponse.reviews;

        // Fetch additional pages if needed to reach sample size
        if (sampleSize > 100 && reviewsResponse.cursor) {
          const remaining = sampleSize - allReviews.length;
          const secondPageSize = Math.min(remaining, 100);

          const page2 = await steamClient.getAppReviews(validatedInput.appId, {
            language: validatedInput.language,
            reviewType: validatedInput.reviewType,
            limit: secondPageSize,
            cursor: reviewsResponse.cursor,
          });

          allReviews = [...allReviews, ...page2.reviews];
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
        let analysis;
        if (validatedInput.topic) {
          analysis = analyzeTopicFocused(allReviews, validatedInput.topic);
        } else {
          analysis = summarizeReviews(allReviews);
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
