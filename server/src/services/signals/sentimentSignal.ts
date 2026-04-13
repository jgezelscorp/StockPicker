import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';

// ─── Sentiment source interfaces ──────────────────────────────────

interface NewsSentimentItem {
  headline: string;
  source: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number;  // -1 to +1
  publishedAt: string;
}

interface SocialSentimentData {
  mentionCount: number;
  avgSentiment: number;   // -1 to +1
  buzzLevel: 'low' | 'medium' | 'high' | 'viral';
  positivePct: number;
  negativePct: number;
  neutralPct: number;
}

interface SentimentSources {
  news: NewsSentimentItem[];
  social: SocialSentimentData;
}

// ─── Stubbed API calls (real implementations plug in here) ────────

/**
 * Fetch news sentiment for a stock ticker.
 * STUB: Returns simulated data based on ticker characteristics.
 * Replace with real API: Financial news NLP (e.g., Finnhub, Alpha Vantage)
 */
async function fetchNewsSentiment(symbol: string): Promise<NewsSentimentItem[]> {
  // Deterministic seed from symbol for consistent mock data
  const seed = hashSymbol(symbol);

  const headlines = [
    { template: `${symbol} beats earnings expectations`, baseSentiment: 0.7 },
    { template: `Analysts upgrade ${symbol} price target`, baseSentiment: 0.6 },
    { template: `${symbol} announces strategic partnership`, baseSentiment: 0.4 },
    { template: `Market volatility impacts ${symbol} outlook`, baseSentiment: -0.2 },
    { template: `${symbol} faces regulatory scrutiny`, baseSentiment: -0.5 },
    { template: `Sector rotation affects ${symbol} trading`, baseSentiment: -0.1 },
    { template: `${symbol} reports steady quarterly growth`, baseSentiment: 0.3 },
    { template: `Institutional investors increase ${symbol} holdings`, baseSentiment: 0.5 },
  ];

  // Select 3-5 headlines based on seed
  const count = 3 + (seed % 3);
  const selected: NewsSentimentItem[] = [];

  for (let i = 0; i < count; i++) {
    const idx = (seed + i * 7) % headlines.length;
    const h = headlines[idx];
    // Add some variance to sentiment
    const variance = ((seed * (i + 1)) % 30 - 15) / 100;
    const score = Math.max(-1, Math.min(1, h.baseSentiment + variance));

    selected.push({
      headline: h.template,
      source: ['Reuters', 'Bloomberg', 'CNBC', 'MarketWatch', 'WSJ'][(seed + i) % 5],
      sentiment: score > 0.15 ? 'positive' : score < -0.15 ? 'negative' : 'neutral',
      score,
      publishedAt: new Date(Date.now() - (i * 4 + 1) * 3600000).toISOString(),
    });
  }

  return selected;
}

/**
 * Fetch social media sentiment for a stock ticker.
 * STUB: Returns simulated data.
 * Replace with real API: Twitter/X API, Reddit API, StockTwits
 */
async function fetchSocialSentiment(symbol: string): Promise<SocialSentimentData> {
  const seed = hashSymbol(symbol);

  // Simulate mention count and sentiment distribution
  const baseMentions = 50 + (seed % 500);
  const mentionCount = Math.round(baseMentions * (0.5 + (seed % 100) / 100));

  const positivePct = 30 + (seed % 35);
  const negativePct = 15 + ((seed * 3) % 25);
  const neutralPct = 100 - positivePct - negativePct;

  const avgSentiment = ((positivePct - negativePct) / 100) * 0.8;

  let buzzLevel: SocialSentimentData['buzzLevel'] = 'low';
  if (mentionCount > 400) buzzLevel = 'viral';
  else if (mentionCount > 200) buzzLevel = 'high';
  else if (mentionCount > 100) buzzLevel = 'medium';

  return {
    mentionCount,
    avgSentiment: Math.round(avgSentiment * 100) / 100,
    buzzLevel,
    positivePct,
    negativePct,
    neutralPct: Math.max(0, neutralPct),
  };
}

/**
 * Simple hash of a symbol string for deterministic mock data.
 */
function hashSymbol(symbol: string): number {
  let hash = 0;
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) - hash + symbol.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ─── Scoring logic ────────────────────────────────────────────────

/**
 * Score news sentiment.
 * Returns 0–100 where higher = more positive news sentiment.
 */
function scoreNewsSentiment(news: NewsSentimentItem[]): { score: number; confidence: number } {
  if (news.length === 0) return { score: 50, confidence: 0.1 };

  const avgScore = news.reduce((s, n) => s + n.score, 0) / news.length;
  // Map -1..+1 to 0..100
  const score = Math.round(50 + avgScore * 50);

  // More articles = higher confidence, up to a point
  const articleConfidence = Math.min(1, news.length / 5);
  // Stronger sentiment = higher confidence
  const strengthConfidence = Math.min(1, Math.abs(avgScore) * 1.5 + 0.3);

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence: Math.round(Math.min(articleConfidence, strengthConfidence) * 100) / 100,
  };
}

/**
 * Score social media sentiment.
 * Returns 0–100 where higher = more positive social sentiment.
 */
function scoreSocialSentiment(social: SocialSentimentData): { score: number; confidence: number } {
  // Base score from sentiment
  const sentimentScore = Math.round(50 + social.avgSentiment * 40);

  // Buzz bonus: high activity amplifies the signal direction
  const buzzMultiplier: Record<string, number> = {
    low: 0.8,
    medium: 1.0,
    high: 1.15,
    viral: 1.3,
  };

  const multiplier = buzzMultiplier[social.buzzLevel] || 1;
  const adjustedScore = 50 + (sentimentScore - 50) * multiplier;

  // Confidence: more mentions = more reliable signal
  const mentionConfidence = Math.min(1, social.mentionCount / 300);
  // Strong consensus increases confidence
  const consensusStrength = Math.max(social.positivePct, social.negativePct) / 100;

  return {
    score: Math.max(0, Math.min(100, Math.round(adjustedScore))),
    confidence: Math.round(Math.min(1, mentionConfidence * 0.5 + consensusStrength * 0.5) * 100) / 100,
  };
}

// ─── Main export ──────────────────────────────────────────────────

/**
 * Aggregate sentiment from news and social media sources.
 * Score: 0–100 (higher = more positive sentiment)
 */
export async function analyzeSentiment(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  // Fetch from all sentiment sources in parallel
  const [newsItems, socialData] = await Promise.all([
    fetchNewsSentiment(stock.symbol),
    fetchSocialSentiment(stock.symbol),
  ]);

  const newsResult = scoreNewsSentiment(newsItems);
  const socialResult = scoreSocialSentiment(socialData);

  // Weighted combination: news 55%, social 45%
  const newsWeight = 0.55;
  const socialWeight = 0.45;

  const compositeScore = Math.round(
    newsResult.score * newsWeight + socialResult.score * socialWeight,
  );

  const compositeConfidence = Math.round(
    (newsResult.confidence * newsWeight + socialResult.confidence * socialWeight) * 100,
  ) / 100;

  const finalScore = Math.max(0, Math.min(100, compositeScore));

  const direction = finalScore >= 60 ? 'bullish' as const
    : finalScore <= 40 ? 'bearish' as const
    : 'neutral' as const;

  const positiveCount = newsItems.filter(n => n.sentiment === 'positive').length;
  const negativeCount = newsItems.filter(n => n.sentiment === 'negative').length;

  return {
    source: 'social_sentiment',
    score: finalScore,
    confidence: compositeConfidence,
    direction,
    reasoning: `News: ${positiveCount} positive, ${negativeCount} negative of ${newsItems.length} articles. Social: ${socialData.buzzLevel} buzz, ${socialData.positivePct}% positive mentions (${socialData.mentionCount} total).`,
    breakdown: {
      newsScore: newsResult.score,
      newsConfidence: newsResult.confidence,
      newsCount: newsItems.length,
      socialScore: socialResult.score,
      socialConfidence: socialResult.confidence,
      socialBuzz: socialData.buzzLevel,
      socialMentions: socialData.mentionCount,
      positivePct: socialData.positivePct,
      negativePct: socialData.negativePct,
    },
  };
}
