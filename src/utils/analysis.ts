/**
 * Analysis utilities for sentiment analysis and review summarization
 *
 * This module provides NLP capabilities using the `natural` library for:
 * - Sentiment analysis of review text
 * - Keyword extraction from reviews
 * - Comprehensive review summarization
 */

import natural from 'natural';
import type { SentimentAnalysis, Review, ReviewAnalysis, ExampleQuote } from '../types.js';

// Extract needed components from natural library
const { SentimentAnalyzer, PorterStemmer } = natural;

/**
 * Maximum length for review excerpts
 */
const MAX_EXCERPT_LENGTH = 200;

/**
 * Maximum number of example quotes to include in analysis
 */
const MAX_EXAMPLE_QUOTES = 5;

/**
 * Generate a Steam community URL for a specific review
 *
 * @param appId - Steam AppID of the game
 * @param recommendationId - The review's unique recommendation ID
 * @returns Full Steam community URL to the review
 */
export function generateReviewUrl(appId: number, recommendationId: string): string {
  return `https://steamcommunity.com/profiles/recommended/${appId}/${recommendationId}`;
}

/**
 * Truncate text to a maximum length, adding ellipsis if needed
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length (default: MAX_EXCERPT_LENGTH)
 * @returns Truncated text with ellipsis if needed
 */
function truncateText(text: string, maxLength: number = MAX_EXCERPT_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  // Find a good break point (space) near the max length
  const breakPoint = text.lastIndexOf(' ', maxLength - 3);
  if (breakPoint > maxLength / 2) {
    return text.substring(0, breakPoint) + '...';
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Select representative example quotes from reviews
 *
 * Selects a mix of positive and negative reviews, prioritizing those with
 * more helpful votes and substantive content.
 *
 * @param reviews - Array of reviews to select from
 * @param appId - Steam AppID for generating URLs
 * @param maxQuotes - Maximum number of quotes to return
 * @returns Array of ExampleQuote objects
 */
export function selectExampleQuotes(
  reviews: Review[],
  appId: number,
  maxQuotes: number = MAX_EXAMPLE_QUOTES
): ExampleQuote[] {
  if (reviews.length === 0) {
    return [];
  }

  // Separate positive and negative reviews
  const positiveReviews = reviews.filter((r) => r.votedUp);
  const negativeReviews = reviews.filter((r) => !r.votedUp);

  // Sort each group by helpful votes (descending)
  const sortedPositive = [...positiveReviews].sort((a, b) => b.votesHelpful - a.votesHelpful);
  const sortedNegative = [...negativeReviews].sort((a, b) => b.votesHelpful - a.votesHelpful);

  // Select quotes alternating between positive and negative
  const quotes: ExampleQuote[] = [];
  const positiveCount = Math.ceil(maxQuotes / 2);
  const negativeCount = maxQuotes - positiveCount;

  // Add top positive reviews
  for (let i = 0; i < Math.min(positiveCount, sortedPositive.length); i++) {
    const review = sortedPositive[i];
    quotes.push({
      excerpt: truncateText(review.review.trim()),
      url: generateReviewUrl(appId, review.recommendationId),
      isPositive: true,
      votesHelpful: review.votesHelpful,
      playtimeHours: Math.round(review.author.playtimeAtReview / 60),
      authorSteamId: review.author.steamId,
    });
  }

  // Add top negative reviews
  for (let i = 0; i < Math.min(negativeCount, sortedNegative.length); i++) {
    const review = sortedNegative[i];
    quotes.push({
      excerpt: truncateText(review.review.trim()),
      url: generateReviewUrl(appId, review.recommendationId),
      isPositive: false,
      votesHelpful: review.votesHelpful,
      playtimeHours: Math.round(review.author.playtimeAtReview / 60),
      authorSteamId: review.author.steamId,
    });
  }

  // Sort final quotes by helpful votes for better presentation
  return quotes.sort((a, b) => b.votesHelpful - a.votesHelpful).slice(0, maxQuotes);
}

/**
 * Analyze sentiment of review text
 *
 * Uses the AFINN lexicon via natural's SentimentAnalyzer to score text
 * from -1 (negative) to 1 (positive).
 *
 * @param text - The review text to analyze
 * @returns SentimentAnalysis object with score, label, and confidence
 */
export function analyzeSentiment(text: string): SentimentAnalysis {
  const analyzer = new SentimentAnalyzer('English', PorterStemmer, 'afinn');
  const tokens = text.toLowerCase().split(/\s+/);
  const score = analyzer.getSentiment(tokens);

  // Determine label and confidence
  let label: 'positive' | 'negative' | 'neutral';
  let confidence: number;

  if (score > 0.1) {
    label = 'positive';
    confidence = Math.min(score, 1);
  } else if (score < -0.1) {
    label = 'negative';
    confidence = Math.min(Math.abs(score), 1);
  } else {
    label = 'neutral';
    confidence = 1 - Math.abs(score);
  }

  return {
    score,
    label,
    confidence,
  };
}

/**
 * Extract keywords from text using frequency analysis
 *
 * Tokenizes text, removes stop words, and returns the most frequent
 * meaningful terms.
 *
 * @param text - The text to extract keywords from
 * @param limit - Maximum number of keywords to return (default: 10)
 * @returns Array of top keywords sorted by frequency
 */
export function extractKeywords(text: string, limit = 10): string[] {
  // Common stop words to filter out
  const stopWords = new Set([
    'the',
    'a',
    'an',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'for',
    'of',
    'with',
    'by',
    'from',
    'as',
    'is',
    'was',
    'are',
    'been',
    'be',
    'have',
    'has',
    'had',
    'do',
    'does',
    'did',
    'will',
    'would',
    'could',
    'should',
    'may',
    'might',
    'must',
    'can',
    'this',
    'that',
    'these',
    'those',
    'i',
    'you',
    'he',
    'she',
    'it',
    'we',
    'they',
    'me',
    'him',
    'her',
    'us',
    'them',
    'my',
    'your',
    'his',
    'its',
    'our',
    'their',
    'what',
    'which',
    'who',
    'when',
    'where',
    'why',
    'how',
    'all',
    'each',
    'every',
    'both',
    'few',
    'more',
    'most',
    'other',
    'some',
    'such',
    'no',
    'nor',
    'not',
    'only',
    'own',
    'same',
    'so',
    'than',
    'too',
    'very',
    'just',
    'game',
    'play',
    'played',
    'playing',
  ]);

  // Tokenize and count words
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !stopWords.has(word));

  // Count frequencies
  const frequencies = new Map<string, number>();
  for (const word of words) {
    frequencies.set(word, (frequencies.get(word) || 0) + 1);
  }

  // Sort by frequency and return top N
  return Array.from(frequencies.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word);
}

/**
 * Analyze a collection of reviews and generate insights
 *
 * Performs comprehensive analysis including:
 * - Sentiment analysis of all reviews
 * - Keyword extraction from positive and negative reviews separately
 * - Overall sentiment calculation
 * - Summary text generation
 * - Example quotes with clickable Steam community links
 *
 * @param reviews - Array of Review objects to analyze
 * @param appId - Steam AppID for generating review URLs (optional, enables example quotes)
 * @returns ReviewAnalysis object with comprehensive insights
 */
export function summarizeReviews(reviews: Review[], appId?: number): ReviewAnalysis {
  if (reviews.length === 0) {
    return {
      summary: 'No reviews to analyze',
      sentiment: { score: 0, label: 'neutral', confidence: 0 },
      commonThemes: [],
      positiveKeywords: [],
      negativeKeywords: [],
      totalAnalyzed: 0,
      sampleSize: 0,
    };
  }

  // Separate positive and negative reviews
  const positiveReviews = reviews.filter((r) => r.votedUp);
  const negativeReviews = reviews.filter((r) => !r.votedUp);

  // Analyze sentiment of each review
  const sentiments = reviews.map((r) => analyzeSentiment(r.review));
  const avgScore = sentiments.reduce((sum, s) => sum + s.score, 0) / sentiments.length;
  const avgConfidence = sentiments.reduce((sum, s) => sum + s.confidence, 0) / sentiments.length;

  // Overall sentiment
  let overallLabel: 'positive' | 'negative' | 'neutral';
  if (avgScore > 0.1) overallLabel = 'positive';
  else if (avgScore < -0.1) overallLabel = 'negative';
  else overallLabel = 'neutral';

  // Extract keywords from positive and negative reviews
  const positiveText = positiveReviews.map((r) => r.review).join(' ');
  const negativeText = negativeReviews.map((r) => r.review).join(' ');

  const positiveKeywords = extractKeywords(positiveText, 10);
  const negativeKeywords = extractKeywords(negativeText, 10);

  // Combine all keywords for common themes
  const allText = reviews.map((r) => r.review).join(' ');
  const commonThemes = extractKeywords(allText, 15);

  // Generate summary
  const posPercent = Math.round((positiveReviews.length / reviews.length) * 100);
  const negPercent = 100 - posPercent;

  const summary =
    `Analyzed ${reviews.length} reviews: ${posPercent}% positive, ${negPercent}% negative. ` +
    `Overall sentiment is ${overallLabel} (score: ${avgScore.toFixed(2)}). ` +
    `Common themes: ${commonThemes.slice(0, 5).join(', ')}.`;

  // Select example quotes if appId is provided
  const exampleQuotes = appId ? selectExampleQuotes(reviews, appId) : undefined;

  return {
    summary,
    sentiment: {
      score: avgScore,
      label: overallLabel,
      confidence: avgConfidence,
    },
    commonThemes,
    positiveKeywords,
    negativeKeywords,
    totalAnalyzed: reviews.length,
    sampleSize: reviews.length,
    exampleQuotes,
  };
}

/**
 * Analyze reviews with focus on a specific topic/theme
 *
 * Filters reviews to only those mentioning the topic, then performs
 * comprehensive analysis on the relevant subset.
 *
 * @param reviews - Array of Review objects to search through
 * @param topic - The topic/keyword to filter reviews by
 * @param appId - Steam AppID for generating review URLs (optional, enables example quotes)
 * @returns ReviewAnalysis object focused on the specified topic
 */
export function analyzeTopicFocused(
  reviews: Review[],
  topic: string,
  appId?: number
): ReviewAnalysis {
  // Filter reviews that mention the topic
  const topicLower = topic.toLowerCase();
  const relevantReviews = reviews.filter((r) => r.review.toLowerCase().includes(topicLower));

  if (relevantReviews.length === 0) {
    return {
      summary: `No reviews found mentioning "${topic}". Try a different topic or broader search term.`,
      sentiment: { score: 0, label: 'neutral', confidence: 0 },
      commonThemes: [],
      positiveKeywords: [],
      negativeKeywords: [],
      totalAnalyzed: 0,
      sampleSize: reviews.length,
    };
  }

  // Analyze only the relevant reviews (pass appId for example quotes)
  const baseAnalysis = summarizeReviews(relevantReviews, appId);

  // Update summary to mention topic focus
  const topicSummary =
    `Topic-focused analysis on "${topic}": ` +
    `Found ${relevantReviews.length} reviews (${Math.round((relevantReviews.length / reviews.length) * 100)}% of ${reviews.length} total). ` +
    baseAnalysis.summary;

  return {
    ...baseAnalysis,
    summary: topicSummary,
    sampleSize: reviews.length, // Total reviews searched
    totalAnalyzed: relevantReviews.length, // Reviews mentioning topic
  };
}
