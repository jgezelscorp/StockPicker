import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';
import { fetchRedditBuzz, type RedditBuzzResult } from '../data/redditClient';

// ─── Urgency & Source Quality ─────────────────────────────────────

/** Keywords that indicate high-urgency breaking news events */
const URGENCY_KEYWORDS = [
  'breaking', 'just announced', 'just reported', 'fda approval', 'fda approves',
  'earnings beat', 'earnings miss', 'profit warning', 'guidance raised',
  'guidance lowered', 'stock halted', 'trading halted', 'sec investigation',
  'ceo resigns', 'ceo fired', 'merger', 'acquisition', 'takeover',
  'bankruptcy', 'default', 'lawsuit', 'recall', 'data breach',
  'beats estimates', 'misses estimates', 'surprise', 'shock', 'emergency',
];

/** High-quality sources get more weight in sentiment calculation */
const SOURCE_QUALITY: Record<string, number> = {
  'reuters': 1.4,
  'bloomberg': 1.4,
  'cnbc': 1.3,
  'wall street journal': 1.3,
  'wsj': 1.3,
  'financial times': 1.3,
  'ft': 1.3,
  'barrons': 1.2,
  'marketwatch': 1.2,
  'associated press': 1.2,
  'ap': 1.2,
  'yahoo finance': 1.1,
  'seekingalpha': 1.0,
  'seeking alpha': 1.0,
  'benzinga': 1.0,
  'motley fool': 0.8,
  'investorplace': 0.8,
};

function getSourceQuality(source: string): number {
  const lower = source.toLowerCase();
  for (const [name, weight] of Object.entries(SOURCE_QUALITY)) {
    if (lower.includes(name)) return weight;
  }
  return 0.9; // Unknown sources get slight discount
}

function detectUrgency(headline: string, summary?: string): { isUrgent: boolean; urgencyScore: number; keywords: string[] } {
  const text = `${headline} ${summary || ''}`.toLowerCase();
  const matched: string[] = [];

  for (const kw of URGENCY_KEYWORDS) {
    if (text.includes(kw)) matched.push(kw);
  }

  return {
    isUrgent: matched.length >= 1,
    urgencyScore: Math.min(1, matched.length * 0.35),
    keywords: matched,
  };
}

// ─── News Velocity ────────────────────────────────────────────────

/**
 * Measure article publication rate — spike detection.
 * A sudden increase in articles about a stock signals an event happening.
 */
function measureNewsVelocity(
  articles: NonNullable<MarketData['newsArticles']>,
): { velocity: number; isSpike: boolean; articlesLast6h: number; articlesLast24h: number } {
  const now = Date.now();
  const sixHoursAgo = now - 6 * 60 * 60 * 1000;
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
  const fortyEightHoursAgo = now - 48 * 60 * 60 * 1000;

  const last6h = articles.filter(a => new Date(a.publishedAt).getTime() >= sixHoursAgo).length;
  const last24h = articles.filter(a => new Date(a.publishedAt).getTime() >= twentyFourHoursAgo).length;
  const prev24h = articles.filter(a => {
    const t = new Date(a.publishedAt).getTime();
    return t >= fortyEightHoursAgo && t < twentyFourHoursAgo;
  }).length;

  const velocity = prev24h > 0 ? last24h / prev24h : last24h > 0 ? 5 : 0;
  const isSpike = velocity >= 2.5 || last6h >= 5;

  return { velocity, isSpike, articlesLast6h: last6h, articlesLast24h: last24h };
}

// ─── Scoring helpers ──────────────────────────────────────────────

/**
 * Compute source-quality-weighted and recency-weighted sentiment.
 * Newer articles and higher-quality sources get more weight.
 */
function weightedSentiment(
  articles: NonNullable<MarketData['newsArticles']>,
): { avgSentiment: number; totalWeight: number } {
  if (articles.length === 0) return { avgSentiment: 0, totalWeight: 0 };

  const now = Date.now();
  const HALF_LIFE_MS = 24 * 60 * 60 * 1000; // 24 hours

  let weightedSum = 0;
  let totalWeight = 0;

  for (const article of articles) {
    const ageMs = Math.max(0, now - new Date(article.publishedAt).getTime());
    const recencyWeight = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    const sourceQuality = getSourceQuality(article.source);
    // Urgent articles get a boost
    const urgency = detectUrgency(article.headline, article.summary);
    const urgencyBoost = urgency.isUrgent ? 1.3 : 1.0;

    const w = Math.max(0.1, recencyWeight) * sourceQuality * urgencyBoost;
    weightedSum += article.sentiment * w;
    totalWeight += w;
  }

  return {
    avgSentiment: totalWeight > 0 ? weightedSum / totalWeight : 0,
    totalWeight,
  };
}

/**
 * Measure consensus — how much the articles agree with each other.
 * Returns 0–1 where 1 = all same direction, 0 = evenly split.
 */
function measureConsensus(articles: NonNullable<MarketData['newsArticles']>): number {
  if (articles.length <= 1) return 0.5;

  let positive = 0;
  let negative = 0;
  for (const a of articles) {
    if (a.sentiment > 0.1) positive++;
    else if (a.sentiment < -0.1) negative++;
  }

  const dominant = Math.max(positive, negative);
  return dominant / articles.length;
}

/**
 * Get real social buzz from Reddit, falling back to news proxy.
 */
async function getSocialBuzz(
  symbol: string,
  articles: NonNullable<MarketData['newsArticles']>,
): Promise<{ score: number; confidence: number; buzzLevel: string; source: 'reddit' | 'news_proxy' }> {
  // Try real Reddit data first
  try {
    const reddit = await fetchRedditBuzz(symbol);
    if (reddit.totalMentions > 0) {
      // Map Reddit sentiment (-1 to +1) and buzz level to score
      const sentimentScore = 50 + reddit.avgSentiment * 30;
      // Buzz velocity bonus — accelerating mentions are significant
      const velocityBonus = Math.min(15, (reddit.buzzVelocity - 1) * 5);
      // Volume bonus — more mentions = stronger signal
      const volumeBonus = Math.min(10, Math.log2(Math.max(1, reddit.totalMentions)) * 2);

      const score = Math.max(0, Math.min(100, Math.round(sentimentScore + velocityBonus + volumeBonus)));
      const confidence = Math.round(Math.min(0.8,
        0.3 + Math.min(0.3, reddit.totalMentions / 20) + Math.min(0.2, Math.abs(reddit.avgSentiment) * 0.4)
      ) * 100) / 100;

      return { score, confidence, buzzLevel: reddit.buzzLevel, source: 'reddit' };
    }
  } catch {
    // Fall through to proxy
  }

  // Fallback: news-based proxy
  const count = articles.length;
  const avgIntensity = count > 0
    ? articles.reduce((s, a) => s + Math.abs(a.sentiment), 0) / count
    : 0;

  let buzzLevel = 'low';
  if (count >= 10 && avgIntensity > 0.4) buzzLevel = 'high';
  else if (count >= 5 && avgIntensity > 0.3) buzzLevel = 'medium';

  const intensityScore = Math.round(50 + avgIntensity * 30 * (count > 5 ? 1.2 : 1.0));
  const score = Math.max(0, Math.min(100, intensityScore));
  const confidence = Math.round(Math.min(0.5, count / 20 + avgIntensity * 0.2) * 100) / 100;

  return { score, confidence, buzzLevel, source: 'news_proxy' };
}

// ─── Main export ──────────────────────────────────────────────────

/**
 * Analyse sentiment using real news articles from Finnhub (via MarketData).
 *
 * Scoring logic:
 * - Recency-weighted average sentiment (newer articles count more)
 * - Article volume → higher confidence
 * - Strong consensus → higher signal strength
 * - Mixed sentiment → lower confidence, neutral direction
 * - Social buzz derived from news volume/intensity as proxy
 *
 * Graceful degradation: no articles → neutral with low confidence.
 */
export async function analyzeSentiment(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const articles = marketData.newsArticles;

  // Graceful degradation: no news data available
  if (!articles || articles.length === 0) {
    return {
      source: 'social_sentiment',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: 'No news articles available — returning neutral.',
      breakdown: { newsCount: 0, socialProxy: 'none' },
    };
  }

  // ── News velocity (spike detection) ──
  const velocity = measureNewsVelocity(articles);

  // ── Urgency detection across articles ──
  let urgentCount = 0;
  let maxUrgencyScore = 0;
  const urgentKeywordsFound: string[] = [];
  for (const article of articles) {
    const u = detectUrgency(article.headline, article.summary);
    if (u.isUrgent) {
      urgentCount++;
      maxUrgencyScore = Math.max(maxUrgencyScore, u.urgencyScore);
      urgentKeywordsFound.push(...u.keywords);
    }
  }

  // ── News scoring ──
  const { avgSentiment } = weightedSentiment(articles);
  const consensus = measureConsensus(articles);

  // Map -1..+1 sentiment to 0..100 score
  const rawNewsScore = 50 + avgSentiment * 50;
  // Amplify when consensus is strong (>70% agreement)
  const consensusAmplifier = consensus > 0.7 ? 1.0 + (consensus - 0.7) * 0.5 : 1.0;
  // Velocity spike amplifies the signal (something is happening)
  const velocityAmplifier = velocity.isSpike ? 1.15 : 1.0;

  const newsScore = Math.max(0, Math.min(100,
    Math.round(50 + (rawNewsScore - 50) * consensusAmplifier * velocityAmplifier),
  ));

  // News confidence: more articles + stronger consensus + urgency = more reliable
  const volumeConfidence = Math.min(1, articles.length / 8);
  const consensusConfidence = consensus;
  const urgencyBoost = maxUrgencyScore * 0.15;
  const newsConfidence = Math.round(
    Math.min(1, volumeConfidence * 0.5 + consensusConfidence * 0.35 + urgencyBoost + 0.15) * 100,
  ) / 100;

  // ── Real social buzz (Reddit) or news-based proxy ──
  const socialBuzz = await getSocialBuzz(stock.symbol, articles);

  // ── Composite: news 60%, social 25%, velocity/urgency 15% ──
  const newsW = 0.60;
  const socialW = 0.25;
  const eventW = 0.15;

  // Event signal: velocity spike + urgency direction
  const eventScore = velocity.isSpike
    ? (avgSentiment > 0 ? 70 : avgSentiment < 0 ? 30 : 50) + (urgentCount > 0 ? avgSentiment * 10 : 0)
    : 50;

  const compositeScore = Math.round(
    newsScore * newsW + socialBuzz.score * socialW + Math.max(0, Math.min(100, eventScore)) * eventW,
  );
  const compositeConfidence = Math.round(
    (newsConfidence * newsW + socialBuzz.confidence * socialW + (velocity.isSpike ? 0.6 : 0.3) * eventW) * 100,
  ) / 100;

  const finalScore = Math.max(0, Math.min(100, compositeScore));

  // Mixed sentiment with low consensus → push toward neutral, lower confidence
  const finalConfidence = consensus < 0.5
    ? Math.round(compositeConfidence * 0.7 * 100) / 100
    : compositeConfidence;

  const direction = finalScore >= 60 ? 'bullish' as const
    : finalScore <= 40 ? 'bearish' as const
    : 'neutral' as const;

  const positiveCount = articles.filter(a => a.sentiment > 0.1).length;
  const negativeCount = articles.filter(a => a.sentiment < -0.1).length;
  const neutralCount = articles.length - positiveCount - negativeCount;

  const velocityNote = velocity.isSpike ? ` NEWS SPIKE (${velocity.velocity.toFixed(1)}x normal).` : '';
  const urgencyNote = urgentCount > 0 ? ` ${urgentCount} urgent articles.` : '';

  return {
    source: 'social_sentiment',
    score: finalScore,
    confidence: finalConfidence,
    direction,
    reasoning: `${articles.length} articles: ${positiveCount} positive, ${negativeCount} negative, ${neutralCount} neutral. Consensus: ${(consensus * 100).toFixed(0)}%. Social: ${socialBuzz.buzzLevel} (${socialBuzz.source}).${velocityNote}${urgencyNote}`,
    breakdown: {
      newsScore,
      newsConfidence,
      newsCount: articles.length,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      consensus: Math.round(consensus * 100) / 100,
      socialScore: socialBuzz.score,
      socialConfidence: socialBuzz.confidence,
      socialBuzzLevel: socialBuzz.buzzLevel,
      socialSource: socialBuzz.source,
      newsVelocity: Math.round(velocity.velocity * 100) / 100,
      isNewsSpike: velocity.isSpike,
      articlesLast6h: velocity.articlesLast6h,
      articlesLast24h: velocity.articlesLast24h,
      urgentArticles: urgentCount,
      urgencyKeywords: [...new Set(urgentKeywordsFound)].slice(0, 5),
      positiveCount,
      negativeCount,
      neutralCount,
    },
  };
}
