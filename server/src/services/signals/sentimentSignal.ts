import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';

// ─── Scoring helpers ──────────────────────────────────────────────

/**
 * Compute recency-weighted average sentiment from real news articles.
 * Newer articles get exponentially more weight (half-life: ~24 hours).
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
    // Minimum weight of 0.1 so older articles still contribute
    const w = Math.max(0.1, recencyWeight);
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
 * Derive a social buzz proxy from news volume and sentiment intensity.
 * TODO: Replace with real social API (Reddit, StockTwits) when available.
 */
function deriveSocialProxy(
  articles: NonNullable<MarketData['newsArticles']>,
): { score: number; confidence: number; buzzLevel: string } {
  const count = articles.length;
  const avgIntensity = count > 0
    ? articles.reduce((s, a) => s + Math.abs(a.sentiment), 0) / count
    : 0;

  // More articles with strong sentiment → higher social buzz proxy
  let buzzLevel = 'low';
  if (count >= 10 && avgIntensity > 0.4) buzzLevel = 'high';
  else if (count >= 5 && avgIntensity > 0.3) buzzLevel = 'medium';

  // Social proxy score: high intensity news = social amplification
  const intensityScore = Math.round(50 + avgIntensity * 30 * (count > 5 ? 1.2 : 1.0));
  const score = Math.max(0, Math.min(100, intensityScore));

  // Low confidence since this is a proxy, not real social data
  const confidence = Math.round(Math.min(0.5, count / 20 + avgIntensity * 0.2) * 100) / 100;

  return { score, confidence, buzzLevel };
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

  // ── News scoring ──
  const { avgSentiment } = weightedSentiment(articles);
  const consensus = measureConsensus(articles);

  // Map -1..+1 sentiment to 0..100 score
  const rawNewsScore = 50 + avgSentiment * 50;
  // Amplify when consensus is strong (>70% agreement)
  const consensusAmplifier = consensus > 0.7 ? 1.0 + (consensus - 0.7) * 0.5 : 1.0;
  const newsScore = Math.max(0, Math.min(100,
    Math.round(50 + (rawNewsScore - 50) * consensusAmplifier),
  ));

  // News confidence: more articles + stronger consensus = more reliable
  const volumeConfidence = Math.min(1, articles.length / 8);
  const consensusConfidence = consensus;
  const newsConfidence = Math.round(
    Math.min(1, volumeConfidence * 0.6 + consensusConfidence * 0.4) * 100,
  ) / 100;

  // ── Social proxy (derived from news volume/intensity) ──
  const socialProxy = deriveSocialProxy(articles);

  // ── Composite: news 70%, social proxy 30% (proxy gets less weight) ──
  const newsW = 0.70;
  const socialW = 0.30;

  const compositeScore = Math.round(newsScore * newsW + socialProxy.score * socialW);
  const compositeConfidence = Math.round(
    (newsConfidence * newsW + socialProxy.confidence * socialW) * 100,
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

  return {
    source: 'social_sentiment',
    score: finalScore,
    confidence: finalConfidence,
    direction,
    reasoning: `${articles.length} articles: ${positiveCount} positive, ${negativeCount} negative, ${neutralCount} neutral. Consensus: ${(consensus * 100).toFixed(0)}%. Social buzz proxy: ${socialProxy.buzzLevel}.`,
    breakdown: {
      newsScore,
      newsConfidence,
      newsCount: articles.length,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      consensus: Math.round(consensus * 100) / 100,
      socialProxyScore: socialProxy.score,
      socialProxyConfidence: socialProxy.confidence,
      socialBuzzLevel: socialProxy.buzzLevel,
      positiveCount,
      negativeCount,
      neutralCount,
    },
  };
}
