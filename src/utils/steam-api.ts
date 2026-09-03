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
import { DEFAULT_STOREFRONT } from './storefront.js';
import type { StorefrontOptions } from './storefront.js';
import type {
  ServerConfig,
  SteamGame,
  SteamGameInfo,
  SteamAppDetailsResponse,
  ReviewStats,
  FetchReviewsInput,
  PaginatedReviewsResponse,
  Review,
  SteamReviewsResponse,
  AppAnnouncementsResponse,
  FetchAppAnnouncementsInput,
  SteamAppAnnouncement,
  SteamAppNewsResponse,
  SteamDeckCompatibility,
} from '../types.js';

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
   * NOTE: Steam disabled multiple AppIDs in a single request in November 2014.
   * This method now makes individual requests for each AppID to work around
   * this limitation.
   *
   * @param appIds - Single AppID or array of AppIDs to fetch
   * @param options - Effective Steam store country and language
   * @returns Promise resolving to game information or explicit unavailable results
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
  async getAppDetails(
    appIds: number | number[],
    options: StorefrontOptions = DEFAULT_STOREFRONT
  ): Promise<SteamGameInfo[]> {
    // Normalize to array
    const appIdArray = Array.isArray(appIds) ? appIds : [appIds];

    // Steam disabled multiple AppIDs in a single request (November 2014).
    // We must make individual requests for each AppID.
    // Make requests in parallel for efficiency
    const fetchPromises = appIdArray.map(async (appId) => {
      try {
        const gameData = await this.getStoreAppDetails(appId, options);

        if (gameData?.success && this.hasUsableAppDetails(gameData.data, appId)) {
          return this.normalizeAppDetails(gameData.data, options);
        }
        return this.unavailableAppDetails(appId, options);
      } catch (error) {
        console.error(`Failed to fetch game ${appId}:`, error);
        return this.unavailableAppDetails(appId, options);
      }
    });

    return Promise.all(fetchPromises);
  }

  private unavailableAppDetails(appId: number, storefront: StorefrontOptions): SteamGameInfo {
    return {
      appId,
      storefront: {
        ...storefront,
        languageStatus: 'requested_not_verified',
        priceStatus: 'unavailable',
      },
      warnings: [
        {
          source: 'steam_store',
          message: `Steam Store information is unavailable for AppID ${appId}`,
        },
      ],
    };
  }

  private async getStoreAppDetails(
    appId: number,
    storefront: StorefrontOptions
  ): Promise<SteamAppDetailsResponse | undefined> {
    const params = new URLSearchParams({
      appids: String(appId),
      cc: storefront.country,
      l: storefront.language,
    });
    const apiUrl = `https://store.steampowered.com/api/appdetails?${params.toString()}`;
    const cacheKey = `appdetails_${appId}_${storefront.country}_${storefront.language}`;
    const response = await this.get<Record<string, SteamAppDetailsResponse>>(
      apiUrl,
      cacheKey,
      this.config.cacheTTL.gameInfo
    );
    return response[String(appId)];
  }

  private hasUsableAppDetails(
    data: SteamAppDetailsResponse['data'] | undefined,
    requestedAppId: number
  ): data is NonNullable<SteamAppDetailsResponse['data']> {
    return (
      data !== undefined &&
      typeof data === 'object' &&
      Number.isInteger(data.steam_appid) &&
      data.steam_appid === requestedAppId &&
      typeof data.name === 'string' &&
      data.name.length > 0 &&
      typeof data.is_free === 'boolean'
    );
  }

  /** Retrieve Valve's Steam Deck compatibility report for one app. */
  async getDeckCompatibility(appId: number): Promise<SteamDeckCompatibility> {
    const malformedResponse = new Error(
      `Malformed Steam Deck compatibility response for AppID ${appId}`
    );
    const params = new URLSearchParams({ nAppID: String(appId) });
    const apiUrl = `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?${params.toString()}`;
    const response = await this.get<unknown>(
      apiUrl,
      `deck_compatibility_${appId}`,
      this.config.cacheTTL.gameInfo
    );

    if (!response || typeof response !== 'object') {
      throw malformedResponse;
    }

    const envelope = response as Record<string, unknown>;
    const results = envelope.results;
    if (envelope.success !== 1) {
      throw malformedResponse;
    }
    if (Array.isArray(results)) {
      if (results.length === 0) {
        return {
          source: 'valve_steam_deck_compatibility',
          category: 'unknown',
          categoryCode: null,
          testResults: [],
        };
      }
      throw malformedResponse;
    }
    if (!results || typeof results !== 'object') {
      throw malformedResponse;
    }

    const report = results as Record<string, unknown>;
    if (
      report.appid !== appId ||
      !Number.isInteger(report.resolved_category) ||
      !Array.isArray(report.resolved_items)
    ) {
      throw malformedResponse;
    }

    const testResults = report.resolved_items.map((rawItem) => {
      if (!rawItem || typeof rawItem !== 'object') {
        throw malformedResponse;
      }

      const item = rawItem as Record<string, unknown>;
      if (
        !Number.isInteger(item.display_type) ||
        typeof item.loc_token !== 'string' ||
        item.loc_token.length === 0
      ) {
        throw malformedResponse;
      }

      return {
        displayType: item.display_type as number,
        token: item.loc_token,
      };
    });
    const categoryCode = report.resolved_category as number;
    const category =
      categoryCode === 1
        ? 'unsupported'
        : categoryCode === 2
          ? 'playable'
          : categoryCode === 3
            ? 'verified'
            : 'unknown';

    return {
      source: 'valve_steam_deck_compatibility',
      category,
      categoryCode,
      testResults,
    };
  }

  /**
   * Normalize Steam API app details response to SteamGame interface.
   *
   * @param data - Raw game data from Steam API
   * @returns Normalized SteamGame object
   */
  private normalizeAppDetails(
    data: NonNullable<SteamAppDetailsResponse['data']>,
    storefront: StorefrontOptions
  ): SteamGame {
    const regionalQuote = data.price_overview;
    const hasValidRegionalQuote =
      regionalQuote !== undefined &&
      typeof regionalQuote.currency === 'string' &&
      regionalQuote.currency.length > 0 &&
      typeof regionalQuote.final === 'number' &&
      Number.isFinite(regionalQuote.final) &&
      regionalQuote.final >= 0 &&
      typeof regionalQuote.final_formatted === 'string' &&
      regionalQuote.final_formatted.length > 0;
    const priceStatus = hasValidRegionalQuote
      ? 'available'
      : data.is_free
        ? 'free'
        : data.release_date?.coming_soon
          ? 'unreleased'
          : 'unavailable';
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
      storefront: {
        ...storefront,
        languageStatus: 'requested_not_verified',
        priceStatus,
      },
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

    if (regionalQuote && !hasValidRegionalQuote) {
      game.warnings = [
        {
          source: 'steam_store',
          message: `Steam returned a malformed regional quote for AppID ${data.steam_appid}`,
        },
      ];
    }

    // Handle price data
    if (hasValidRegionalQuote) {
      game.priceFormatted = regionalQuote.final_formatted;
      game.priceRaw = regionalQuote.final;
      game.currency = regionalQuote.currency;
    } else if (data.is_free) {
      game.priceFormatted = 'Free';
      game.priceRaw = 0;
    }

    // System requirements (PC only for simplicity)
    if (data.pc_requirements) {
      game.systemRequirements = {
        minimum: data.pc_requirements.minimum,
        recommended: data.pc_requirements.recommended,
      };
    }

    // DLC list - store AppIDs only, names will be fetched separately if needed
    if (data.dlc && Array.isArray(data.dlc) && data.dlc.length > 0) {
      game.dlc = data.dlc.slice(0, 10).map((dlcId: number) => ({
        appId: dlcId,
        name: '', // Will be populated by fetchDlcNames if includeDlc is true
      }));
    }

    return game;
  }

  /**
   * Fetch names for DLC AppIDs.
   *
   * Since Steam's appdetails API only returns DLC AppIDs (not names),
   * we need to make separate API calls to get the DLC names.
   *
   * @param dlcAppIds - Array of DLC AppIDs to fetch names for
   * @param options - Effective Steam store country and language
   * @returns Promise resolving to a map of AppID to name
   *
   * @example
   * ```typescript
   * const dlcNames = await client.fetchDlcNames([2378500, 2956320]);
   * // Returns: Map { 2378500 => "Baldur's Gate 3 - Digital Deluxe Edition Upgrade", ... }
   * ```
   */
  async fetchDlcNames(
    dlcAppIds: number[],
    options: StorefrontOptions = DEFAULT_STOREFRONT
  ): Promise<Map<number, string>> {
    const dlcNames = new Map<number, string>();

    // Fetch DLC details in parallel
    const fetchPromises = dlcAppIds.map(async (dlcId) => {
      try {
        const dlcData = await this.getStoreAppDetails(dlcId, options);
        if (dlcData && dlcData.success && dlcData.data) {
          const name = dlcData.data.name;
          dlcNames.set(dlcId, name);
        }
      } catch (error) {
        // If we can't fetch DLC name, we'll use a placeholder
        console.error(`Failed to fetch DLC ${dlcId}:`, error);
        dlcNames.set(dlcId, `DLC ${dlcId}`);
      }
    });

    await Promise.all(fetchPromises);
    return dlcNames;
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

  /** Retrieve official Steam Community announcements for one app. */
  async getAppAnnouncements(
    appId: number,
    options: Pick<FetchAppAnnouncementsInput, 'limit' | 'cursor'> = {}
  ): Promise<AppAnnouncementsResponse> {
    const limit = options.limit ?? 20;
    let boundaryTimestamp: number | undefined;
    let seenBoundaryIds: string[] = [];

    if (options.cursor !== undefined) {
      try {
        if (options.cursor.length > 8192) throw new Error('Cursor is too long');
        const decodedBytes = Buffer.from(options.cursor, 'base64url');
        if (decodedBytes.toString('base64url') !== options.cursor) {
          throw new Error('Cursor encoding is not canonical');
        }
        const decoded = JSON.parse(decodedBytes.toString('utf8')) as Record<string, unknown>;
        if (
          typeof decoded.before !== 'number' ||
          !Number.isInteger(decoded.before) ||
          decoded.before < 0 ||
          decoded.before > 4294967295 ||
          !Array.isArray(decoded.seenIds) ||
          decoded.seenIds.length === 0 ||
          decoded.seenIds.length > 100 ||
          !decoded.seenIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)
        ) {
          throw new Error('Cursor has an invalid shape');
        }
        boundaryTimestamp = decoded.before;
        seenBoundaryIds = [...new Set(decoded.seenIds as string[])];
      } catch {
        throw new Error('Invalid app announcement cursor');
      }
    }

    const params = new URLSearchParams({
      appid: String(appId),
      count: String(limit + seenBoundaryIds.length),
      maxlength: '0',
      feeds: 'steam_community_announcements',
    });
    if (boundaryTimestamp !== undefined) {
      params.set('enddate', String(boundaryTimestamp));
    }
    params.set('format', 'json');

    const cacheKey = `app_announcements_${appId}_${limit}_${options.cursor ?? 'latest'}`;
    const apiUrl = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?${params.toString()}`;
    const response = await this.get<SteamAppNewsResponse>(
      apiUrl,
      cacheKey,
      this.config.cacheTTL.gameInfo
    );
    const appNews = response?.appnews;

    if (!appNews || appNews.appid !== appId || !Array.isArray(appNews.newsitems)) {
      throw new Error(`Malformed Steam app announcement response for AppID ${appId}`);
    }

    const announcements: SteamAppAnnouncement[] = [];
    const seenBoundaryIdSet = new Set(seenBoundaryIds);
    for (const rawItem of appNews.newsitems) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      const item = rawItem as Record<string, unknown>;

      if (item.feedname !== 'steam_community_announcements' || item.appid !== appId) {
        continue;
      }

      if (
        item.date === boundaryTimestamp &&
        typeof item.gid === 'string' &&
        seenBoundaryIdSet.has(item.gid)
      ) {
        continue;
      }

      if (
        typeof item.gid !== 'string' ||
        item.gid.length === 0 ||
        typeof item.title !== 'string' ||
        typeof item.url !== 'string' ||
        item.url.length === 0 ||
        typeof item.author !== 'string' ||
        typeof item.date !== 'number' ||
        !Number.isInteger(item.date) ||
        item.date < 0
      ) {
        throw new Error(`Malformed Steam app announcement metadata for AppID ${appId}`);
      }

      const body = typeof item.contents === 'string' ? item.contents : null;
      const bodyStatus =
        body === null
          ? 'malformed'
          : /(?:\.{3}|…)\s*$/.test(body)
            ? 'possibly_truncated'
            : 'full_requested';
      const tags = Array.isArray(item.tags)
        ? item.tags.filter((tag): tag is string => typeof tag === 'string')
        : undefined;

      announcements.push({
        id: item.gid,
        appId,
        source: 'official_app_announcement',
        title: item.title,
        authorLabel: item.author,
        publishedAt: item.date,
        steamUrl: item.url,
        body,
        bodyFormat: 'steam_markup',
        bodyStatus,
        containsSteamImagePlaceholders: body?.includes('{STEAM_CLAN_IMAGE}') ?? false,
        ...(tags && tags.length > 0 ? { tags } : {}),
      });

      if (announcements.length === limit) break;
    }

    const oldestTimestamp = announcements.reduce<number | null>(
      (oldest, announcement) =>
        oldest === null || announcement.publishedAt < oldest ? announcement.publishedAt : oldest,
      null
    );
    const nextCursor =
      oldestTimestamp === null
        ? null
        : Buffer.from(
            JSON.stringify({
              before: oldestTimestamp,
              seenIds: [
                ...(oldestTimestamp === boundaryTimestamp ? seenBoundaryIds : []),
                ...announcements
                  .filter((announcement) => announcement.publishedAt === oldestTimestamp)
                  .map((announcement) => announcement.id),
              ],
            })
          ).toString('base64url');

    return {
      appId,
      source: 'official_app_announcements',
      announcements,
      nextCursor,
    };
  }

  /**
   * Fetch reviews for a game with filtering and pagination support.
   *
   * Uses Steam's appreviews API to get actual review text and details.
   * Only the first page (without cursor) is cached to avoid pagination issues.
   *
   * @param appId - Steam AppID to query
   * @param options - Optional filtering and pagination options
   * @returns Promise resolving to paginated reviews response
   *
   * @example
   * ```typescript
   * // Basic fetch
   * const result = await client.getAppReviews(570, { limit: 10 });
   * console.log(`Fetched ${result.reviews.length} reviews`);
   *
   * // With filters
   * const positive = await client.getAppReviews(570, {
   *   reviewType: 'positive',
   *   language: 'english',
   *   limit: 20
   * });
   *
   * // Pagination
   * const page2 = await client.getAppReviews(570, {
   *   cursor: page1.cursor
   * });
   * ```
   */
  async getAppReviews(
    appId: number,
    options?: Partial<FetchReviewsInput> & {
      dayRange?: number;
      filterOfftopicActivity?: boolean;
      steamDeckOnly?: boolean;
    }
  ): Promise<PaginatedReviewsResponse> {
    // Build query parameters
    const params = new URLSearchParams({
      json: '1',
      filter: options?.filter || 'all',
      language: options?.language || 'all',
      review_type: options?.reviewType || 'all',
      purchase_type: options?.purchaseType || 'all',
      num_per_page: String(Math.min(options?.limit || 20, 100)), // Max 100
    });

    // Add cursor for pagination if provided
    if (options?.cursor) {
      params.set('cursor', options.cursor);
    }

    // Add day_range filter (only reviews from last N days)
    if (options?.dayRange) {
      params.set('day_range', String(options.dayRange));
    }

    // Add filter_offtopic_activity (0 shows review bombs, 1 filters them)
    if (options?.filterOfftopicActivity !== undefined) {
      params.set('filter_offtopic_activity', options.filterOfftopicActivity ? '1' : '0');
    }

    // Note: Steam Deck filtering is experimental and may not work reliably
    if (options?.steamDeckOnly) {
      params.set('steam_deck', '1');
    }

    // Build cache key (only for first page, without cursor)
    const cacheKey = options?.cursor
      ? undefined
      : `reviews_${appId}_${options?.filter || 'all'}_${options?.language || 'all'}_${options?.reviewType || 'all'}_${options?.purchaseType || 'all'}_${options?.dayRange || ''}_${options?.filterOfftopicActivity ?? ''}_${options?.steamDeckOnly ?? ''}`;

    // Build API URL
    const apiUrl = `https://store.steampowered.com/appreviews/${appId}?${params.toString()}`;

    // Fetch data from Steam API
    const response = await this.get<SteamReviewsResponse>(
      apiUrl,
      cacheKey,
      cacheKey ? this.config.cacheTTL.reviews : undefined
    );

    // Check for valid response
    if (response.success !== 1) {
      return {
        reviews: [],
        cursor: null,
        hasMore: false,
        totalFetched: 0,
      };
    }

    // Normalize reviews
    const normalizedReviews = this.normalizeReviews(response.reviews || []);

    // Build paginated response
    const result: PaginatedReviewsResponse = {
      reviews: normalizedReviews,
      cursor: response.cursor || null,
      hasMore: normalizedReviews.length === (options?.limit || 20),
      totalFetched: normalizedReviews.length,
    };

    return result;
  }

  /**
   * Normalize Steam API reviews response to Review interface.
   *
   * @param reviews - Raw reviews array from Steam API
   * @returns Normalized Review array
   */
  private normalizeReviews(reviews: NonNullable<SteamReviewsResponse['reviews']>): Review[] {
    return reviews.map((review) => ({
      recommendationId: review.recommendationid,
      author: {
        steamId: review.author.steamid,
        numGamesOwned: review.author.num_games_owned,
        numReviews: review.author.num_reviews,
        playtimeForever: review.author.playtime_forever,
        playtimeAtReview: review.author.playtime_at_review,
        lastPlayed: review.author.last_played,
      },
      language: review.language,
      review: review.review,
      timestampCreated: review.timestamp_created,
      timestampUpdated: review.timestamp_updated,
      votedUp: review.voted_up,
      votesUp: review.votes_up,
      votesFunny: review.votes_funny,
      votesHelpful: review.votes_up, // Use votes_up as votesHelpful
      commentCount: review.comment_count,
      steamPurchase: review.steam_purchase,
      receivedForFree: review.received_for_free,
      writtenDuringEarlyAccess: review.written_during_early_access,
    }));
  }
}
