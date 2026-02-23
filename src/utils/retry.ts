/**
 * Retry utility with exponential backoff for handling transient network errors.
 * Provides resilient network request handling for Steam API calls.
 */

/**
 * Structure of an HTTP error response
 */
interface HttpErrorLike {
  code?: string;
  name?: string;
  message?: string;
  response?: {
    status: number;
    headers?: Record<string, string>;
  };
}

/**
 * Configuration options for retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 100ms) */
  initialDelay?: number;
  /** Maximum delay cap in milliseconds (default: 5000ms) */
  maxDelay?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Callback function called on each retry attempt */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * Default retry configuration
 */
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxRetries: 3,
  initialDelay: 100,
  maxDelay: 5000,
  backoffMultiplier: 2,
};

/**
 * Special delay for HTTP 429 (Rate Limit) responses in milliseconds
 */
const RATE_LIMIT_DELAY_MS = 60000; // 60 seconds

/**
 * Checks if an error is retryable (network errors, timeouts, 5xx errors)
 * @param error - The error to check
 * @returns True if the error is retryable
 */
function isRetryableError(error: unknown): boolean {
  const httpError = error as HttpErrorLike;

  // Network connection errors
  if (httpError.code === 'ECONNRESET') return true;
  if (httpError.code === 'ETIMEDOUT') return true;
  if (httpError.code === 'ENOTFOUND') return true;
  if (httpError.code === 'ECONNREFUSED') return true;
  if (httpError.code === 'EAI_AGAIN') return true; // DNS lookup timeout

  // HTTP status errors
  if (httpError.response?.status) {
    const status = httpError.response.status;
    // 5xx server errors are retryable
    if (status >= 500 && status < 600) return true;
    // 429 rate limit is retryable (with special handling)
    if (status === 429) return true;
  }

  // Request timeout errors
  if (
    httpError.name === 'TimeoutError' ||
    (typeof httpError.message === 'string' && httpError.message.includes('timeout'))
  ) {
    return true;
  }

  return false;
}

/**
 * Checks if an error is an HTTP 429 (Rate Limit) error
 * @param error - The error to check
 * @returns True if the error is a 429 rate limit error
 */
function isRateLimitError(error: unknown): boolean {
  const httpError = error as HttpErrorLike;
  return httpError.response?.status === 429;
}

/**
 * Extracts the Retry-After header value from an error response
 * @param error - The error containing the response
 * @returns The retry-after value in milliseconds, or null if not present
 */
function getRetryAfterMs(error: unknown): number | null {
  const httpError = error as HttpErrorLike;
  const retryAfter = httpError.response?.headers?.['retry-after'];
  if (!retryAfter) return null;

  // Try parsing as seconds
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try parsing as date (less common)
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

/**
 * Sleeps for the specified duration
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates the delay for a given retry attempt using exponential backoff
 * @param attempt - Current attempt number (0-indexed)
 * @param options - Retry options
 * @returns Delay in milliseconds
 */
function calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'onRetry'>>): number {
  const delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);
  return Math.min(delay, options.maxDelay);
}

/**
 * Converts an unknown error to an Error object
 * @param error - The error to convert
 * @returns An Error object
 */
function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error(String(error));
}

/**
 * Executes a function with exponential backoff retry logic.
 *
 * Retries on transient errors (network errors, timeouts, 5xx responses).
 * Special handling for HTTP 429 (rate limit) errors with 60-second wait.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns Promise resolving to the function's return value
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const data = await retryWithBackoff(
 *   async () => axios.get('https://api.steampowered.com/...'),
 *   {
 *     maxRetries: 3,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt}: ${error.message}, waiting ${delay}ms`);
 *     }
 *   }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const { maxRetries, onRetry } = config;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = toError(error);

      // Check if we should retry
      if (!isRetryableError(error)) {
        throw lastError;
      }

      // Check if we've exhausted retries
      if (attempt === maxRetries) {
        throw lastError;
      }

      // Calculate delay
      let delay: number;

      // Special handling for HTTP 429 (Rate Limit)
      if (isRateLimitError(error)) {
        // Try to use Retry-After header, otherwise use default 60 seconds
        const retryAfterMs = getRetryAfterMs(error);
        delay = retryAfterMs !== null ? retryAfterMs : RATE_LIMIT_DELAY_MS;
      } else {
        // Standard exponential backoff
        delay = calculateDelay(attempt, config);
      }

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt + 1, delay);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError ?? new Error('Retry exhausted without error');
}

/**
 * Determines if an error should trigger a retry.
 * Useful for custom retry logic or testing.
 *
 * @param error - Error to check
 * @returns True if the error is retryable
 */
export function shouldRetry(error: unknown): boolean {
  return isRetryableError(error);
}
