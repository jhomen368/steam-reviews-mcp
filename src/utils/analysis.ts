/**
 * Analysis utilities for sentiment analysis and review summarization
 *
 * This module provides NLP capabilities using the `natural` library for:
 * - Sentiment analysis of review text
 * - Keyword extraction from reviews
 * - Comprehensive review summarization
 */

import natural from 'natural';
import type { SentimentAnalysis, Review, ReviewAnalysis } from '../types.js';

// Extract needed components from natural library
const { SentimentAnalyzer, PorterStemmer } = natural;

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
 *
 * @param reviews - Array of Review objects to analyze
 * @returns ReviewAnalysis object with comprehensive insights
 */
export function summarizeReviews(reviews: Review[]): ReviewAnalysis {
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
  };
}
