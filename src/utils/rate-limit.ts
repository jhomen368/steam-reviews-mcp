/**
 * Rate limiting utility using a token bucket algorithm.
 * Ensures API requests respect Steam's rate limits.
 */

/**
 * Status information about the rate limiter
 */
export interface RateLimiterStatus {
  /** Number of tokens currently available */
  remaining: number;
  /** Maximum tokens in the bucket */
  total: number;
  /** Timestamp (ms) when the bucket will be fully refilled */
  resetTime: number;
}

/**
 * Token bucket rate limiter for controlling API request rates.
 *
 * Implements a sliding window approach where tokens refill continuously
 * over time rather than in bursts. This provides smoother rate limiting
 * and better respects API limits.
 *
 * @example
 * ```typescript
 * // Create a limiter for 30 requests per minute
 * const limiter = new RateLimiter(30, 60000);
 *
 * // Before each API call
 * await limiter.acquire();
 * const response = await axios.get('...');
 *
 * // Check status
 * console.log(limiter.getStatus());
 * ```
 */
export class RateLimiter {
  private maxTokens: number;
  private refillRate: number; // tokens per millisecond
  private tokens: number;
  private lastRefillTime: number;
  private waitQueue: Array<{
    resolve: () => void;
    timestamp: number;
  }> = [];

  /**
   * Creates a new RateLimiter instance.
   *
   * @param maxRequests - Maximum number of requests allowed in the window
   * @param windowMs - Time window in milliseconds
   */
  constructor(maxRequests: number, windowMs: number) {
    if (maxRequests <= 0) {
      throw new Error('maxRequests must be greater than 0');
    }
    if (windowMs <= 0) {
      throw new Error('windowMs must be greater than 0');
    }

    this.maxTokens = maxRequests;
    this.refillRate = maxRequests / windowMs; // tokens per ms
    this.tokens = this.maxTokens; // Start with full bucket
    this.lastRefillTime = Date.now();
  }

  /**
   * Refills tokens based on elapsed time since last refill.
   * Uses continuous refill (not burst) for smooth rate limiting.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;

    if (elapsed > 0) {
      const tokensToAdd = elapsed * this.refillRate;
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefillTime = now;
    }
  }

  /**
   * Calculates when the next token will be available.
   * @returns Milliseconds until a token is available, or 0 if tokens available
   */
  private getTimeUntilNextToken(): number {
    this.refill();

    if (this.tokens >= 1) {
      return 0;
    }

    // Calculate time needed to refill 1 token
    const tokensNeeded = 1 - this.tokens;
    return Math.ceil(tokensNeeded / this.refillRate);
  }

  /**
   * Processes the wait queue, resolving promises for requests that can now proceed.
   */
  private processQueue(): void {
    while (this.waitQueue.length > 0 && this.tokens >= 1) {
      const next = this.waitQueue.shift();
      if (next) {
        this.tokens -= 1;
        next.resolve();
      }
    }
  }

  /**
   * Acquires a token, waiting if necessary until one is available.
   *
   * This method should be called before each API request to ensure
   * rate limits are respected. It will return immediately if a token
   * is available, or wait until one becomes available.
   *
   * @returns Promise that resolves when a token has been acquired
   *
   * @example
   * ```typescript
   * const limiter = new RateLimiter(30, 60000);
   *
   * // This will wait if rate limit is reached
   * await limiter.acquire();
   *
   * // Safe to make API call now
   * const response = await fetch('https://api.example.com/data');
   * ```
   */
  async acquire(): Promise<void> {
    this.refill();

    // If tokens available, consume one immediately
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }

    // Otherwise, wait in queue
    return new Promise<void>((resolve) => {
      this.waitQueue.push({
        resolve,
        timestamp: Date.now(),
      });

      // Schedule queue processing
      const waitTime = this.getTimeUntilNextToken();
      if (waitTime > 0) {
        setTimeout(() => {
          this.refill();
          this.processQueue();
        }, waitTime);
      }
    });
  }

  /**
   * Gets the current rate limit status.
   *
   * @returns Object containing remaining tokens, total capacity, and reset time
   *
   * @example
   * ```typescript
   * const status = limiter.getStatus();
   * console.log(`${status.remaining}/${status.total} tokens available`);
   * console.log(`Resets at: ${new Date(status.resetTime).toISOString()}`);
   * ```
   */
  getStatus(): RateLimiterStatus {
    this.refill();

    // Calculate when bucket will be full
    const tokensNeeded = this.maxTokens - this.tokens;
    const timeToFull = Math.ceil(tokensNeeded / this.refillRate);
    const resetTime = Date.now() + timeToFull;

    return {
      remaining: Math.floor(this.tokens),
      total: this.maxTokens,
      resetTime,
    };
  }

  /**
   * Resets the rate limiter to full capacity.
   * Useful for testing or after a known pause in requests.
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
    this.processQueue();
  }

  /**
   * Gets the number of requests currently waiting in the queue.
   * @returns Number of pending requests
   */
  getQueueLength(): number {
    return this.waitQueue.length;
  }
}

/**
 * Default rate limiter instance for Steam API.
 * Configured for 30 requests per minute (Steam's typical limit).
 */
export const steamRateLimiter = new RateLimiter(30, 60000);
