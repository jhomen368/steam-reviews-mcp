/**
 * Server configuration module
 *
 * This module provides configuration values loaded from environment variables
 * with sensible defaults for the Steam Reviews MCP Server.
 */

import type { ServerConfig, LogLevel } from './types.js';

/**
 * Parse environment variable as boolean
 * @param value - The environment variable value
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed boolean value
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

/**
 * Parse environment variable as number
 * @param value - The environment variable value
 * @param defaultValue - Default value if not set or invalid
 * @returns Parsed number value
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse environment variable as log level
 * @param value - The environment variable value
 * @param defaultValue - Default value if not set or invalid
 * @returns Valid log level
 */
function parseLogLevel(value: string | undefined, defaultValue: LogLevel): LogLevel {
  if (value === undefined) return defaultValue;
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  if (validLevels.includes(value as LogLevel)) {
    return value as LogLevel;
  }
  return defaultValue;
}

/**
 * Server configuration loaded from environment variables
 *
 * All configuration values have sensible defaults and can be overridden
 * via environment variables.
 */
export const config: ServerConfig = {
  cacheEnabled: parseBoolean(process.env.CACHE_ENABLED, true),
  cacheTTL: {
    reviews: parseNumber(process.env.CACHE_REVIEWS_TTL, 900000), // 15 min
    gameInfo: parseNumber(process.env.CACHE_GAME_INFO_TTL, 7200000), // 2 hours
    statistics: parseNumber(process.env.CACHE_STATISTICS_TTL, 300000), // 5 min
    analysis: parseNumber(process.env.CACHE_ANALYSIS_TTL, 1800000), // 30 min
  },
  cacheMaxSize: parseNumber(process.env.CACHE_MAX_SIZE, 1000),
  rateLimitEnabled: parseBoolean(process.env.RATE_LIMIT_ENABLED, true),
  maxRequestsPerMinute: parseNumber(process.env.MAX_REQUESTS_PER_MINUTE, 30),
  httpMode: parseBoolean(process.env.HTTP_MODE, false),
  port: parseNumber(process.env.PORT, 8086),
  logLevel: parseLogLevel(process.env.LOG_LEVEL, 'info'),
};

/**
 * Default cache TTL values in milliseconds
 */
export const DEFAULT_CACHE_TTL = {
  reviews: 900000, // 15 minutes
  gameInfo: 7200000, // 2 hours
  statistics: 300000, // 5 minutes
  analysis: 1800000, // 30 minutes
} as const;

/**
 * Default rate limiting configuration
 */
export const DEFAULT_RATE_LIMIT = {
  enabled: true,
  maxRequestsPerMinute: 30,
} as const;

/**
 * Default server configuration
 */
export const DEFAULT_SERVER = {
  httpMode: false,
  port: 8086,
  logLevel: 'info' as LogLevel,
} as const;
