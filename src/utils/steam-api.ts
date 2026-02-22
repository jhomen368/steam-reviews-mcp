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
import { CacheManager } from './cache.js';
import { RateLimiter } from './rate-limit.js';
import { retryWithBackoff } from './retry.js';
import type { ServerConfig } from '../types.js';

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
}
