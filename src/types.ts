/**
 * Core type definitions for Steam Reviews MCP Server
 *
 * This module contains all TypeScript interfaces and types used throughout
 * the application for Steam game data, reviews, and analysis.
 */

/**
 * Represents a Steam game with basic information
 */
export interface SteamGame {
  appId: number;
  name: string;
  description?: string;
  shortDescription?: string;
  headerImage?: string;
  developers?: string[];
  publishers?: string[];
  releaseDate?: string;
  isFree?: boolean;
  priceFormatted?: string;
  priceRaw?: number;
  currency?: string;
  metacriticScore?: number;
  tags?: string[];
  genres?: string[];
  platforms?: {
    windows?: boolean;
    mac?: boolean;
    linux?: boolean;
  };
  currentPlayers?: number;
}

/**
 * Represents a single Steam review
 */
export interface Review {
  recommendationId: string;
  author: {
    steamId: string;
    numGamesOwned?: number;
    numReviews?: number;
    playtimeForever: number;
    playtimeAtReview: number;
    lastPlayed?: number;
  };
  language: string;
  review: string; // The actual review text
  timestampCreated: number;
  timestampUpdated: number;
  votedUp: boolean; // true = positive, false = negative
  votesUp: number;
  votesFunny: number;
  votesHelpful: number; // Calculated field
  commentCount: number;
  steamPurchase: boolean;
  receivedForFree: boolean;
  writtenDuringEarlyAccess: boolean;
}

/**
 * Aggregated review statistics for a game
 */
export interface ReviewStats {
  totalReviews: number;
  totalPositive: number;
  totalNegative: number;
  scorePercent: number; // 0-100
  scoreText: string; // e.g., "Very Positive", "Mixed", "Overwhelmingly Positive"
  recentReviews?: {
    total: number;
    positive: number;
    negative: number;
    scorePercent: number;
    scoreText: string;
  };
}

/**
 * Filter criteria for game info
 */
export interface GameInfoCriteria {
  minReviewScore?: number; // Minimum review score percentage (0-100)
  minReviews?: number; // Minimum number of reviews
  maxPrice?: number; // Maximum price in cents
  requireFree?: boolean; // Only free games
  requireMetacritic?: boolean; // Only games with metacritic scores
  minMetacritic?: number; // Minimum metacritic score (0-100)
}

/**
 * Sentiment analysis result
 */
export interface SentimentAnalysis {
  score: number; // -1 to 1 (negative to positive)
  label: 'positive' | 'negative' | 'neutral';
  confidence: number; // 0 to 1
}

/**
 * Review analysis summary
 */
export interface ReviewAnalysis {
  summary: string;
  sentiment: SentimentAnalysis;
  commonThemes: string[];
  positiveKeywords: string[];
  negativeKeywords: string[];
  totalAnalyzed: number;
  sampleSize: number;
}

/**
 * Input parameters for search_steam_games tool
 */
export interface SearchGamesInput {
  query: string;
  limit?: number; // Default: 10
}

/**
 * Input parameters for get_game_info tool
 */
export interface GetGameInfoInput {
  appIds: number[]; // Support batch queries
  includeStats?: boolean; // Default: true
  includeCurrentPlayers?: boolean; // Default: false
}

/**
 * Input parameters for fetch_reviews tool
 */
export interface FetchReviewsInput {
  appId: number;
  filter?: 'all' | 'recent' | 'updated'; // Default: 'all'
  language?: string; // e.g., 'english', 'schinese'
  reviewType?: 'all' | 'positive' | 'negative'; // Default: 'all'
  purchaseType?: 'all' | 'steam' | 'non_steam_purchase'; // Default: 'all'
  limit?: number; // Default: 20, max: 100
  cursor?: string; // For pagination
}

/**
 * Input parameters for analyze_reviews tool
 */
export interface AnalyzeReviewsInput {
  appId: number;
  sampleSize?: number; // Default: 100
  language?: string; // Default: 'english'
  reviewType?: 'all' | 'positive' | 'negative'; // Default: 'all'
}

/**
 * Server configuration
 */
export interface ServerConfig {
  cacheEnabled: boolean;
  cacheTTL: {
    reviews: number; // milliseconds
    gameInfo: number;
    statistics: number;
    analysis: number;
  };
  cacheMaxSize: number;
  rateLimitEnabled: boolean;
  maxRequestsPerMinute: number;
  httpMode: boolean;
  port: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Cache entry wrapper for storing data with metadata
 */
export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

/**
 * Paginated response wrapper for reviews
 */
export interface PaginatedReviewsResponse {
  reviews: Review[];
  cursor: string | null;
  hasMore: boolean;
  totalFetched: number;
}

/**
 * Steam Store API response for app details
 */
export interface SteamAppDetailsResponse {
  success: boolean;
  data?: {
    type: string;
    name: string;
    steam_appid: number;
    required_age: number;
    is_free: boolean;
    detailed_description?: string;
    short_description?: string;
    header_image?: string;
    developers?: string[];
    publishers?: string[];
    price_overview?: {
      currency: string;
      initial: number;
      final: number;
      discount_percent: number;
      final_formatted: string;
    };
    platforms?: {
      windows: boolean;
      mac: boolean;
      linux: boolean;
    };
    metacritic?: {
      score: number;
      url: string;
    };
    genres?: Array<{
      id: string;
      description: string;
    }>;
    release_date?: {
      coming_soon: boolean;
      date: string;
    };
  };
}

/**
 * Steam Reviews API response structure
 */
export interface SteamReviewsResponse {
  success: number;
  query_summary?: {
    num_reviews: number;
    review_score: number;
    review_score_desc: string;
    total_positive: number;
    total_negative: number;
    total_reviews: number;
  };
  reviews?: Array<{
    recommendationid: string;
    author: {
      steamid: string;
      num_games_owned?: number;
      num_reviews?: number;
      playtime_forever: number;
      playtime_at_review: number;
      last_played?: number;
    };
    language: string;
    review: string;
    timestamp_created: number;
    timestamp_updated: number;
    voted_up: boolean;
    votes_up: number;
    votes_funny: number;
    comment_count: number;
    steam_purchase: boolean;
    received_for_free: boolean;
    written_during_early_access: boolean;
  }>;
  cursor?: string;
}

/**
 * Log levels for the server
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Filter types for review queries
 */
export type ReviewFilter = 'all' | 'recent' | 'updated';

/**
 * Review type filter
 */
export type ReviewTypeFilter = 'all' | 'positive' | 'negative';

/**
 * Purchase type filter
 */
export type PurchaseTypeFilter = 'all' | 'steam' | 'non_steam_purchase';
