/**
 * Cache Manager with LRU eviction and TTL support
 *
 * This module provides a generic caching system designed to reduce Steam API calls
 * by 70-85% through aggressive caching with Least Recently Used (LRU) eviction
 * and variable Time-To-Live (TTL) support.
 *
 * @module utils/cache
 */

import type { CacheEntry } from '../types.js';

/**
 * Internal cache entry with LRU tracking
 * Extends the base CacheEntry with access order for LRU eviction
 */
interface InternalCacheEntry<T> extends CacheEntry<T> {
  /** Access order counter (for LRU eviction) - higher = more recent */
  accessOrder: number;
}

/**
 * Cache statistics for monitoring hit/miss rates
 */
export interface CacheStats {
  /** Current number of items in cache */
  size: number;
  /** Number of cache hits */
  hits: number;
  /** Number of cache misses */
  misses: number;
  /** Hit rate as a percentage (0-100) */
  hitRate: number;
}

/**
 * Generic Cache Manager with LRU eviction and TTL support
 *
 * Provides efficient in-memory caching with:
 * - LRU (Least Recently Used) eviction when cache reaches maxSize
 * - TTL (Time To Live) expiration for cache entries
 * - Hit/miss statistics tracking
 * - Generic type support for any cached data type
 *
 * @typeParam T - The type of data to be cached
 *
 * @example
 * ```typescript
 * import { CacheManager } from './utils/cache.js';
 * import type { Review } from './types.js';
 *
 * const reviewCache = new CacheManager<Review[]>(1000);
 *
 * // Store reviews with 15 minute TTL
 * reviewCache.set('app_570_reviews', reviews, 900000);
 *
 * // Retrieve reviews
 * const cached = reviewCache.get('app_570_reviews');
 * if (cached) {
 *   console.log('Cache hit!', cached);
 * }
 * ```
 */
export class CacheManager<T> {
  /** Internal Map storing cache entries */
  private cache: Map<string, InternalCacheEntry<T>>;

  /** Maximum number of items to store in cache */
  private maxSize: number;

  /** Number of successful cache hits */
  private hits: number = 0;

  /** Number of cache misses (not found or expired) */
  private misses: number = 0;

  /** Monotonic counter for LRU access order tracking */
  private accessCounter: number = 0;

  /**
   * Create a new CacheManager instance
   *
   * @param maxSize - Maximum number of items to store in the cache
   *                   When the cache reaches this size, LRU eviction occurs
   */
  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Check if a cache entry has expired
   *
   * @param entry - The cache entry to check
   * @returns true if the entry has expired, false otherwise
   */
  private isExpired(entry: InternalCacheEntry<T>): boolean {
    const now = Date.now();
    return now > entry.timestamp + entry.ttl;
  }

  /**
   * Evict the least recently used item from the cache
   *
   * Finds the entry with the lowest accessOrder counter and removes it.
   * This is called when the cache reaches its maximum size.
   */
  private evictLRU(): void {
    if (this.cache.size < this.maxSize) {
      return;
    }

    let lruKey: string | null = null;
    let lruOrder = Infinity;

    // Find the entry with the lowest access order (oldest access)
    for (const [key, entry] of this.cache.entries()) {
      if (entry.accessOrder < lruOrder) {
        lruOrder = entry.accessOrder;
        lruKey = key;
      }
    }

    // Remove the LRU entry
    if (lruKey !== null) {
      this.cache.delete(lruKey);
    }
  }

  /**
   * Clean up expired entries from the cache
   *
   * Removes all entries that have exceeded their TTL.
   * This is called periodically to prevent memory bloat from expired entries.
   *
   * @returns The number of expired entries removed
   */
  cleanup(): number {
    let removed = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Store an item in the cache
   *
   * If the cache is full, the least recently used item will be evicted
   * before adding the new item. If an item with the same key already exists,
   * it will be replaced.
   *
   * @param key - Unique identifier for the cache entry
   * @param value - The data to cache
   * @param ttl - Time to live in milliseconds
   *
   * @example
   * ```typescript
   * // Cache game info for 2 hours
   * gameCache.set('game_570', gameData, 7200000);
   * ```
   */
  set(key: string, value: T, ttl: number): void {
    // Evict LRU if cache is full (but not if we're updating an existing key)
    if (!this.cache.has(key)) {
      this.evictLRU();
    }

    const now = Date.now();
    const order = ++this.accessCounter;
    const entry: InternalCacheEntry<T> = {
      data: value,
      timestamp: now,
      ttl: ttl,
      accessOrder: order,
    };

    this.cache.set(key, entry);
  }

  /**
   * Retrieve an item from the cache
   *
   * Returns undefined if the item doesn't exist or has expired.
   * Updates the last accessed time for LRU tracking on successful retrieval.
   *
   * @param key - The cache key to look up
   * @returns The cached data if found and not expired, undefined otherwise
   *
   * @example
   * ```typescript
   * const reviews = reviewCache.get('app_570_reviews');
   * if (reviews) {
   *   // Use cached reviews
   * } else {
   *   // Fetch from API
   * }
   * ```
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    // Not found
    if (!entry) {
      this.misses++;
      return undefined;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }

    // Update access order for LRU tracking
    entry.accessOrder = ++this.accessCounter;
    this.hits++;

    return entry.data;
  }

  /**
   * Check if a key exists in the cache and is not expired
   *
   * This method does not update the LRU access time.
   *
   * @param key - The cache key to check
   * @returns true if the key exists and is not expired, false otherwise
   *
   * @example
   * ```typescript
   * if (gameCache.has('game_570')) {
   *   console.log('Game data is cached');
   * }
   * ```
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Remove a specific item from the cache
   *
   * @param key - The cache key to remove
   *
   * @example
   * ```typescript
   * gameCache.delete('game_570');
   * ```
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear all items from the cache
   *
   * Removes all entries and resets statistics.
   *
   * @example
   * ```typescript
   * gameCache.clear();
   * ```
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics
   *
   * Returns information about the current state of the cache,
   * including size, hits, misses, and hit rate.
   *
   * @returns Cache statistics object
   *
   * @example
   * ```typescript
   * const stats = gameCache.getStats();
   * console.log(`Hit rate: ${stats.hitRate.toFixed(1)}%`);
   * ```
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? (this.hits / total) * 100 : 0;

    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: hitRate,
    };
  }

  /**
   * Get the current number of items in the cache
   *
   * @returns The number of cached items
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get the maximum cache size
   *
   * @returns The maximum number of items the cache can hold
   */
  get maxCacheSize(): number {
    return this.maxSize;
  }
}
