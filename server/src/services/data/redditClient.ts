/**
 * Reddit Buzz Client
 * 
 * Tracks stock/ETF mentions and sentiment across financial subreddits.
 * Uses Reddit's public JSON API (no API key required — append .json to any URL).
 * 
 * Subreddits monitored:
 * - r/wallstreetbets — high volume, retail momentum indicator
 * - r/stocks — moderate volume, more analytical
 * - r/investing — lower volume, longer-term perspective
 * 
 * Signals produced:
 * - Mention count and velocity (mentions now vs 24h ago)
 * - Basic sentiment from post titles/body
 * - Buzz level classification (viral, high, medium, low, none)
 */

import axios from 'axios';
import { getDb } from '../../db';

// ─── Types ──────────────────────────────────────────────────────

export interface RedditMention {
  subreddit: string;
  title: string;
  score: number;      // Reddit upvotes (net)
  numComments: number;
  createdUtc: number;  // Unix timestamp
  sentiment: number;   // -1 to +1
}

export interface RedditBuzzResult {
  /** Stock symbol queried */
  symbol: string;
  /** Total mentions found across all subreddits */
  totalMentions: number;
  /** Mentions weighted by subreddit engagement (upvotes, comments) */
  weightedMentions: number;
  /** Average sentiment across mentions (-1 to +1) */
  avgSentiment: number;
  /** Buzz velocity: ratio of recent mentions vs older mentions */
  buzzVelocity: number;
  /** Buzz classification */
  buzzLevel: 'viral' | 'high' | 'medium' | 'low' | 'none';
  /** Per-subreddit breakdown */
  subredditBreakdown: Record<string, { mentions: number; avgSentiment: number }>;
  /** Individual mentions (for debugging/display) */
  mentions: RedditMention[];
  /** Data freshness */
  fetchedAt: string;
}

// ─── Configuration ──────────────────────────────────────────────

const SUBREDDITS = ['wallstreetbets', 'stocks', 'investing'];

/** How many posts to scan per subreddit (Reddit returns max 100 per page) */
const POSTS_PER_SUB = 50;

/** Cache TTL — Reddit data is fresh but we don't want to hammer the API */
const REDDIT_CACHE_MINUTES = 30;

// ─── Sentiment Scoring ──────────────────────────────────────────

const BULLISH_WORDS = [
  'buy', 'calls', 'moon', 'rocket', 'bullish', 'long', 'yolo',
  'undervalued', 'breakout', 'squeeze', 'diamond hands', 'to the moon',
  'earnings beat', 'upgrade', 'growth', 'strong', 'all in', 'accumulate',
  'dip buying', 'loaded up', 'position',
];

const BEARISH_WORDS = [
  'sell', 'puts', 'short', 'bearish', 'dump', 'crash', 'overvalued',
  'bag holder', 'loss porn', 'bubble', 'bankruptcy', 'fraud', 'scam',
  'downgrade', 'weak', 'red', 'dead cat', 'exit', 'avoid', 'warning',
];

function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  let bullish = 0;
  let bearish = 0;

  for (const word of BULLISH_WORDS) {
    if (lower.includes(word)) bullish++;
  }
  for (const word of BEARISH_WORDS) {
    if (lower.includes(word)) bearish++;
  }

  const total = bullish + bearish;
  if (total === 0) return 0;
  return Math.round(((bullish - bearish) / total) * 100) / 100;
}

// ─── Cache ──────────────────────────────────────────────────────

function ensureCacheTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_data_cache (
      cache_key   TEXT PRIMARY KEY,
      data        TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    )
  `);
}

function getCached<T>(key: string): T | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT data FROM market_data_cache WHERE cache_key = ? AND expires_at > datetime('now')"
    ).get(key) as any;
    if (row) return JSON.parse(row.data) as T;
  } catch { /* miss */ }
  return null;
}

function setCache(key: string, data: unknown, ttlMinutes: number): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO market_data_cache (cache_key, data, expires_at)
      VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))
    `).run(key, JSON.stringify(data), ttlMinutes);
  } catch { /* ignore */ }
}

// ─── Reddit API ─────────────────────────────────────────────────

/**
 * Search a subreddit for posts mentioning a symbol.
 * Uses Reddit's public JSON API (no authentication needed).
 */
async function searchSubreddit(
  subreddit: string,
  symbol: string,
): Promise<RedditMention[]> {
  try {
    // Reddit's search API via public JSON endpoint
    const url = `https://www.reddit.com/r/${subreddit}/search.json`;
    const resp = await axios.get(url, {
      params: {
        q: `$${symbol} OR ${symbol}`,
        restrict_sr: 'on',
        sort: 'new',
        t: 'week',   // last 7 days
        limit: POSTS_PER_SUB,
      },
      timeout: 10_000,
      headers: {
        'User-Agent': 'APEX-StockBot/1.0 (market research)',
      },
    });

    if (!resp.data?.data?.children) return [];

    const posts = resp.data.data.children;
    const mentions: RedditMention[] = [];

    for (const post of posts) {
      const data = post.data;
      if (!data) continue;

      const title = data.title || '';
      const selftext = data.selftext || '';
      const fullText = `${title} ${selftext}`;

      // Verify the symbol is actually mentioned (search can be fuzzy)
      const symbolUpper = symbol.toUpperCase();
      const textUpper = fullText.toUpperCase();
      if (!textUpper.includes(`$${symbolUpper}`) && !textUpper.includes(` ${symbolUpper} `)) {
        // Check for symbol at start/end of text as well
        if (!textUpper.startsWith(`${symbolUpper} `) && !textUpper.endsWith(` ${symbolUpper}`)) {
          continue;
        }
      }

      mentions.push({
        subreddit,
        title,
        score: data.score || 0,
        numComments: data.num_comments || 0,
        createdUtc: data.created_utc || 0,
        sentiment: scoreSentiment(fullText),
      });
    }

    return mentions;
  } catch (err: any) {
    if (err.response?.status === 429) {
      console.warn(`[Reddit] Rate limited on r/${subreddit}`);
    } else {
      console.warn(`[Reddit] Failed to search r/${subreddit} for ${symbol}: ${err.message}`);
    }
    return [];
  }
}

// ─── Main Export ────────────────────────────────────────────────

/**
 * Fetch Reddit buzz data for a stock symbol across monitored subreddits.
 * Returns mention counts, sentiment, and buzz velocity.
 */
export async function fetchRedditBuzz(symbol: string): Promise<RedditBuzzResult> {
  ensureCacheTable();

  const cacheKey = `reddit:${symbol}`;
  const cached = getCached<RedditBuzzResult>(cacheKey);
  if (cached) return cached;

  // Search all subreddits in parallel
  const results = await Promise.all(
    SUBREDDITS.map(sub => searchSubreddit(sub, symbol)),
  );

  const allMentions = results.flat();

  // Per-subreddit breakdown
  const subredditBreakdown: RedditBuzzResult['subredditBreakdown'] = {};
  for (const sub of SUBREDDITS) {
    const subMentions = allMentions.filter(m => m.subreddit === sub);
    const avgSent = subMentions.length > 0
      ? subMentions.reduce((s, m) => s + m.sentiment, 0) / subMentions.length
      : 0;
    subredditBreakdown[sub] = {
      mentions: subMentions.length,
      avgSentiment: Math.round(avgSent * 100) / 100,
    };
  }

  // Weighted mentions (higher engagement = more influential)
  const weightedMentions = allMentions.reduce((sum, m) => {
    const engagementWeight = 1 + Math.log2(Math.max(1, m.score)) * 0.3 + Math.log2(Math.max(1, m.numComments)) * 0.2;
    return sum + engagementWeight;
  }, 0);

  // Sentiment — engagement-weighted average
  let sentimentSum = 0;
  let sentimentWeightSum = 0;
  for (const m of allMentions) {
    const weight = 1 + Math.log2(Math.max(1, m.score)) * 0.5;
    sentimentSum += m.sentiment * weight;
    sentimentWeightSum += weight;
  }
  const avgSentiment = sentimentWeightSum > 0
    ? Math.round((sentimentSum / sentimentWeightSum) * 100) / 100
    : 0;

  // Buzz velocity: compare last 24h mentions vs older mentions
  const oneDayAgo = Date.now() / 1000 - 24 * 60 * 60;
  const twoDaysAgo = Date.now() / 1000 - 48 * 60 * 60;
  const recentMentions = allMentions.filter(m => m.createdUtc >= oneDayAgo).length;
  const olderMentions = allMentions.filter(m => m.createdUtc >= twoDaysAgo && m.createdUtc < oneDayAgo).length;
  const buzzVelocity = olderMentions > 0
    ? Math.round((recentMentions / olderMentions) * 100) / 100
    : recentMentions > 0 ? 5.0 : 0; // 5x if new mentions from nothing

  // Classify buzz level
  let buzzLevel: RedditBuzzResult['buzzLevel'];
  if (allMentions.length >= 20 && buzzVelocity >= 3) {
    buzzLevel = 'viral';
  } else if (allMentions.length >= 10 || buzzVelocity >= 2) {
    buzzLevel = 'high';
  } else if (allMentions.length >= 5) {
    buzzLevel = 'medium';
  } else if (allMentions.length >= 1) {
    buzzLevel = 'low';
  } else {
    buzzLevel = 'none';
  }

  const result: RedditBuzzResult = {
    symbol,
    totalMentions: allMentions.length,
    weightedMentions: Math.round(weightedMentions * 100) / 100,
    avgSentiment,
    buzzVelocity,
    buzzLevel,
    subredditBreakdown,
    mentions: allMentions.slice(0, 10), // Keep top 10 for display
    fetchedAt: new Date().toISOString(),
  };

  if (allMentions.length > 0) {
    setCache(cacheKey, result, REDDIT_CACHE_MINUTES);
  } else {
    // Cache empty results for a shorter time
    setCache(cacheKey, result, 15);
  }

  return result;
}
