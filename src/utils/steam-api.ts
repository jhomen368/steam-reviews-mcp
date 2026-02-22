/**
 * Steam API Client
 *
 * This module provides a centralized client for all Steam API interactions.
 * It integrates caching, rate limiting, and retry logic for resilient
 * communication with Steam's APIs.
 *
 * @module utils/steam-api
 */

import axios from 'axios';
import type { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { CacheManager } from './cache.js';
import { RateLimiter } from './rate-limit.js';
import { retryWithBackoff } from './retry.js';
import type { ServerConfig, SteamGame, SteamAppDetailsResponse, ReviewStats } from '../types.js';

/**
 * User agent string for Steam API requests
 */
const USER_AGENT = 'steam-reviews-mcp/0.1.0';

/**
 * Steam API Client
 *
 * Central communication layer for all Steam API interactions.
 * Provides a generic `get` method that handles:
 * - Caching (with LRU eviction and TTL)
 * - Rate limiting (token bucket algorithm)
 * - Retry logic (exponential backoff for transient errors)
 *
 * @example
 * ```typescript
 * const client = new SteamAPIClient(config);
 *
 * // Fetch game details
 * const gameData = await client.get<SteamAppDetailsResponse>(
 *   'https://store.steampowered.com/api/appdetails?appids=570',
 *   'game_570',
 *   config.cacheTTL.gameInfo
 * );
 * ```
 */
export class SteamAPIClient {
  /** Cache manager for storing API responses */
  private cache: CacheManager<unknown>;

  /** Rate limiter for controlling request frequency */
  private rateLimiter: RateLimiter;

  /** Server configuration */
  protected config: ServerConfig;

  /**
   * Creates a new SteamAPIClient instance.
   *
   * @param config - Server configuration containing cache and rate limit settings
   *
   * @example
   * ```typescript
   * import { config } from '../config.js';
   * const client = new SteamAPIClient(config);
   * ```
   */
  constructor(config: ServerConfig) {
    this.config = config;
    this.cache = new CacheManager<unknown>(config.cacheMaxSize);
    this.rateLimiter = new RateLimiter(config.maxRequestsPerMinute, 60000);
  }

  /**
   * Generic HTTP GET method with integrated caching, rate limiting, and retry.
   *
   * This is the workhorse method that all specific API endpoint methods will use.
   * It implements the following flow:
   *
   * 1. Check cache first (if cacheKey provided and caching enabled)
   * 2. Apply rate limiting (if enabled)
   * 3. Make HTTP request with retry logic
   * 4. Cache the response (if cacheKey and TTL provided)
   * 5. Return typed response data
   *
   * @typeParam T - The expected type of the response data
   * @param url - The full URL to fetch
   * @param cacheKey - Optional cache key for storing/retrieving cached responses
   * @param cacheTTL - Optional TTL in milliseconds for the cache entry
   * @returns Promise resolving to the typed response data
   * @throws Error if the request fails after all retries
   *
   * @example
   * ```typescript
   * // Simple request without caching
   * const data = await client.get<MyResponseType>('https://api.example.com/data');
   *
   * // Request with caching
   * const data = await client.get<MyResponseType>(
   *   'https://api.example.com/data',
   *   'my_cache_key',
   *   300000 // 5 minutes
   * );
   * ```
   */
  async get<T>(url: string, cacheKey?: string, cacheTTL?: number): Promise<T> {
    // Step 1: Check cache first (if caching is enabled and key provided)
    if (this.config.cacheEnabled && cacheKey) {
      const cached = this.cache.get(cacheKey) as T | undefined;
      if (cached !== undefined) {
        return cached;
      }
    }

    // Step 2: Apply rate limiting (if enabled)
    if (this.config.rateLimitEnabled) {
      await this.rateLimiter.acquire();
    }

    // Step 3: Make HTTP request with retry logic
    const response = await retryWithBackoff<AxiosResponse<T>>(
      async () => {
        return axios.get<T>(url, {
          headers: {
            'User-Agent': USER_AGENT,
          },
        });
      },
      {
        maxRetries: 3,
        initialDelay: 100,
        maxDelay: 5000,
        backoffMultiplier: 2,
      }
    );

    const data = response.data;

    // Step 4: Cache the response (if cache key and TTL provided)
    if (this.config.cacheEnabled && cacheKey && cacheTTL !== undefined) {
      this.cache.set(cacheKey, data, cacheTTL);
    }

    // Step 5: Return typed response data
    return data;
  }

  /**
   * Gets cache statistics for monitoring.
   *
   * @returns Cache statistics including size, hits, misses, and hit rate
   *
   * @example
   * ```typescript
   * const stats = client.getCacheStats();
   * console.log(`Cache hit rate: ${stats.hitRate.toFixed(1)}%`);
   * ```
   */
  getCacheStats(): { size: number; hits: number; misses: number; hitRate: number } {
    return this.cache.getStats();
  }

  /**
   * Gets rate limiter status for monitoring.
   *
   * @returns Rate limiter status including remaining tokens and reset time
   *
   * @example
   * ```typescript
   * const status = client.getRateLimiterStatus();
   * console.log(`${status.remaining}/${status.total} requests remaining`);
   * ```
   */
  getRateLimiterStatus(): { remaining: number; total: number; resetTime: number } {
    return this.rateLimiter.getStatus();
  }

  /**
   * Clears the cache.
   * Useful for testing or forcing fresh data fetches.
   *
   * @example
   * ```typescript
   * client.clearCache();
   * ```
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resets the rate limiter to full capacity.
   * Useful for testing or after a known pause in requests.
   *
   * @example
   * ```typescript
   * client.resetRateLimiter();
   * ```
   */
  resetRateLimiter(): void {
    this.rateLimiter.reset();
  }

  /**
   * Search for games on the Steam store by name/keywords.
   *
   * This method scrapes the Steam search results page since Steam doesn't
   * provide a dedicated search API. Results are cached for 2 hours.
   *
   * @param query - Search query (game name or keywords)
   * @param limit - Maximum number of results to return (default: 10)
   * @returns Promise resolving to an array of SteamGame objects
   *
   * @example
   * ```typescript
   * const games = await client.searchGames('Dota', 5);
   * console.log(games[0].name); // "Dota 2"
   * ```
   */
  async searchGames(query: string, limit: number = 10): Promise<SteamGame[]> {
    const cacheKey = `search_${query}_${limit}`;

    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey) as SteamGame[] | undefined;
      if (cached !== undefined) {
        return cached;
      }
    }

    // Build search URL
    const searchUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(query)}`;

    // Fetch HTML content using the get method for rate limiting and retry
    const html = await this.get<string>(searchUrl);

    // Parse HTML with cheerio
    const $ = cheerio.load(html);
    const results: SteamGame[] = [];

    // Select search result rows
    $('.search_result_row').each((index, element) => {
      if (results.length >= limit) {
        return false; // Stop iteration when limit reached
      }

      const $row = $(element);

      // Extract AppID from data attribute
      const appIdStr = $row.attr('data-ds-appid');
      if (!appIdStr) {
        return; // Skip if no AppID
      }
      const appId = parseInt(appIdStr, 10);
      if (isNaN(appId)) {
        return; // Skip if AppID is not a valid number
      }

      // Extract game name
      const name = $row.find('.title').text().trim();

      // Extract price
      const priceText = $row.find('.search_price').text().trim();
      const priceFormatted = this.parsePriceText(priceText);

      // Extract image URL
      const headerImage = $row.find('.search_capsule img').attr('src') || undefined;

      // Extract release date (if available)
      const releaseDate = $row.find('.search_released').text().trim() || undefined;

      // Build SteamGame object
      const game: SteamGame = {
        appId,
        name,
        headerImage,
        releaseDate,
        priceFormatted,
      };

      results.push(game);
    });

    // Cache the results
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, results, this.config.cacheTTL.gameInfo);
    }

    return results;
  }

  /**
   * Parse price text from Steam search results.
   *
   * @param priceText - Raw price text from search result
   * @returns Formatted price string or undefined
   */
  private parsePriceText(priceText: string): string | undefined {
    // Clean up the price text
    const cleaned = priceText.replace(/\s+/g, ' ').trim();

    // Handle free to play
    if (cleaned.toLowerCase().includes('free')) {
      return 'Free';
    }

    // Handle discounted prices (take the final price)
    // Format is often "Original Price\nFinal Price" or just "Price"
    const lines = cleaned
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      // Return the last non-empty line (final price after discount)
      return lines[lines.length - 1] || undefined;
    }

    return cleaned || undefined;
  }

  /**
   * Get detailed information for one or more games by AppID.
   *
   * Uses Steam's appdetails API to fetch comprehensive game information.
   * Each game is cached individually for efficient subsequent lookups.
   *
   * @param appIds - Single AppID or array of AppIDs to fetch
   * @returns Promise resolving to an array of SteamGame objects
   *
   * @example
   * ```typescript
   * // Single game
   * const games = await client.getAppDetails(570);
   *
   * // Multiple games
   * const games = await client.getAppDetails([570, 730]);
   * ```
   */
  async getAppDetails(appIds: number | number[]): Promise<SteamGame[]> {
    // Normalize to array
    const appIdArray = Array.isArray(appIds) ? appIds : [appIds];

    // Check cache for each game individually
    const results: SteamGame[] = [];
    const uncachedAppIds: number[] = [];

    for (const appId of appIdArray) {
      const cacheKey = `game_${appId}`;
      if (this.config.cacheEnabled) {
        const cached = this.cache.get(cacheKey) as SteamGame | undefined;
        if (cached !== undefined) {
          results.push(cached);
          continue;
        }
      }
      uncachedAppIds.push(appId);
    }

    // If all games were cached, return early
    if (uncachedAppIds.length === 0) {
      return results;
    }

    // Build API URL with comma-separated AppIDs
    const appIdsParam = uncachedAppIds.join(',');
    const apiUrl = `https://store.steampowered.com/api/appdetails?appids=${appIdsParam}&cc=us&l=english`;

    // Fetch data from Steam API
    const response = await this.get<Record<string, SteamAppDetailsResponse>>(apiUrl);

    // Process each game's response
    for (const appId of uncachedAppIds) {
      const appIdStr = appId.toString();
      const gameData = response[appIdStr];

      if (gameData && gameData.success && gameData.data) {
        const steamGame = this.normalizeAppDetails(gameData.data);

        // Cache the normalized game data
        const cacheKey = `game_${appId}`;
        if (this.config.cacheEnabled) {
          this.cache.set(cacheKey, steamGame, this.config.cacheTTL.gameInfo);
        }

        results.push(steamGame);
      }
      // If success is false, we simply don't add this game to results
      // This handles cases where the AppID doesn't exist or is not a game
    }

    return results;
  }

  /**
   * Normalize Steam API app details response to SteamGame interface.
   *
   * @param data - Raw game data from Steam API
   * @returns Normalized SteamGame object
   */
  private normalizeAppDetails(data: NonNullable<SteamAppDetailsResponse['data']>): SteamGame {
    const game: SteamGame = {
      appId: data.steam_appid,
      name: data.name,
      description: data.detailed_description,
      shortDescription: data.short_description,
      headerImage: data.header_image,
      developers: data.developers,
      publishers: data.publishers,
      releaseDate: data.release_date?.date,
      isFree: data.is_free,
      platforms: data.platforms
        ? {
            windows: data.platforms.windows,
            mac: data.platforms.mac,
            linux: data.platforms.linux,
          }
        : undefined,
      metacriticScore: data.metacritic?.score,
      genres: data.genres?.map((g) => g.description),
      tags: data.genres?.map((g) => g.description), // Use genres as tags for now
    };

    // Handle price data
    if (data.price_overview) {
      game.priceFormatted = data.price_overview.final_formatted;
      game.priceRaw = data.price_overview.final;
      game.currency = data.price_overview.currency;
    } else if (data.is_free) {
      game.priceFormatted = 'Free';
      game.priceRaw = 0;
    }

    return game;
  }

  /**
   * Get the current number of players for a game.
   *
   * Uses Steam's ISteamUserStats API to get real-time player counts.
   * Results are cached for 5 minutes.
   *
   * @param appId - Steam AppID to query
   * @returns Promise resolving to the current player count
   *
   * @example
   * ```typescript
   * const players = await client.getCurrentPlayers(570);
   * console.log(`Dota 2 has ${players} players online`);
   * ```
   */
  async getCurrentPlayers(appId: number): Promise<number> {
    const cacheKey = `players_${appId}`;

    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey) as number | undefined;
      if (cached !== undefined) {
        return cached;
      }
    }

    // Build API URL
    const apiUrl = `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`;

    // Fetch data from Steam API
    interface PlayerCountResponse {
      response: {
        player_count: number;
        result: number;
      };
    }

    const response = await this.get<PlayerCountResponse>(apiUrl);

    // Extract player count
    const playerCount = response.response?.player_count ?? 0;

    // Cache the result
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, playerCount, this.config.cacheTTL.statistics);
    }

    return playerCount;
  }

  /**
   * Get review summary for a game.
   *
   * Uses Steam's appreviews API to get the overall review score summary.
   * This provides the Steam user review classification (e.g., "Very Positive", "Mixed").
   * Results are cached for the statistics TTL period.
   *
   * @param appId - Steam AppID to query
   * @returns Promise resolving to ReviewStats object with score information
   *
   * @example
   * ```typescript
   * const stats = await client.getReviewSummary(570);
   * console.log(`Dota 2: ${stats.scoreText} (${stats.scorePercent}%)`);
   * ```
   */
  async getReviewSummary(appId: number): Promise<ReviewStats | null> {
    const cacheKey = `review_summary_${appId}`;

    // Check cache first
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(cacheKey) as ReviewStats | undefined;
      if (cached !== undefined) {
        return cached;
      }
    }

    // Build API URL - request just the summary, no actual reviews
    const apiUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&purchase_type=all&language=all&num_per_page=0`;

    // Fetch data from Steam API
    interface ReviewSummaryResponse {
      success: number;
      query_summary?: {
        num_reviews: number;
        review_score: number;
        review_score_desc: string;
        total_positive: number;
        total_negative: number;
        total_reviews: number;
      };
    }

    const response = await this.get<ReviewSummaryResponse>(apiUrl);

    // Check for valid response
    if (response.success !== 1 || !response.query_summary) {
      return null;
    }

    const summary = response.query_summary;

    // Build ReviewStats object
    const reviewStats: ReviewStats = {
      totalReviews: summary.total_reviews,
      totalPositive: summary.total_positive,
      totalNegative: summary.total_negative,
      scorePercent:
        summary.total_reviews > 0
          ? Math.round((summary.total_positive / summary.total_reviews) * 100)
          : 0,
      scoreText: summary.review_score_desc,
    };

    // Cache the result
    if (this.config.cacheEnabled) {
      this.cache.set(cacheKey, reviewStats, this.config.cacheTTL.statistics);
    }

    return reviewStats;
  }
}
