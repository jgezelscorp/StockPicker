import type { Stock, SignalSource, SignalDirection } from '../../types';
import { analyzeValuation } from './valuationSignal';
import { analyzeTrend } from './trendSignal';
import { analyzeSentiment } from './sentimentSignal';
import { analyzeSearchInterest } from './searchInterestSignal';

// ─── Signal interfaces ────────────────────────────────────────────

/** Market data passed into signal analyzers */
export interface MarketData {
  currentPrice?: number;
  peRatio?: number;
  pbRatio?: number;
  dividendYield?: number;
  eps?: number;
  marketCap?: number;
  week52High?: number;
  week52Low?: number;
  revenueGrowth?: number;
  profitMargin?: number;
  sma50?: number;
  sma200?: number;
  priceHistory?: number[];     // daily closing prices, oldest first
  volumeHistory?: number[];    // daily volumes, oldest first
  /** Real news articles from Finnhub with pre-computed sentiment */
  newsArticles?: {
    headline: string;
    source: string;
    sentiment: number;  // -1 to +1
    publishedAt: string;
    summary?: string;
  }[];
  /** Real search trend data from Google Trends */
  searchTrend?: {
    currentInterest: number;
    previousInterest: number;
    trend: 'rising' | 'falling' | 'stable';
    changePercent: number;
  };
  // Alpha Vantage enrichment
  forwardPE?: number;
  pegRatio?: number;
  analystTargetPrice?: number;
  beta?: number;
  bookValue?: number;
  priceToBook?: number;
  evToRevenue?: number;
  evToEbitda?: number;
  quarterlyRevenueGrowthYOY?: number;
  quarterlyEarningsGrowthYOY?: number;
}

/** Result from a single signal analyser */
export interface SignalResult {
  source: SignalSource;
  score: number;               // 0–100 (higher = more bullish)
  confidence: number;          // 0–1 (data quality / signal strength)
  direction: SignalDirection;
  reasoning: string;           // human-readable explanation
  breakdown: Record<string, unknown>;  // source-specific details
}

/** Result from the aggregate analyser */
export interface AggregateSignalResult {
  overallScore: number;        // 0–100 composite score
  overallConfidence: number;   // 0–1 agreement-adjusted confidence
  direction: SignalDirection;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  compositeScore: number;      // -1 to +1 for DB storage
  signals: SignalResult[];
  rationale: string;
  weightedBreakdown: {
    source: SignalSource;
    weight: number;
    score: number;
    weightedScore: number;
    direction: SignalDirection;
  }[];
}

// ─── Signal weights (task spec: Val 35%, Trend 25%, Sentiment 20%, Search 20%)

interface SignalWeightConfig {
  source: SignalSource;
  weight: number;
  analyzer: (stock: Stock, marketData: MarketData) => Promise<SignalResult>;
}

const SIGNAL_PIPELINE: SignalWeightConfig[] = [
  { source: 'pe_ratio',          weight: 0.35, analyzer: analyzeValuation },
  { source: 'price_trend',       weight: 0.25, analyzer: analyzeTrend },
  { source: 'social_sentiment',  weight: 0.20, analyzer: analyzeSentiment },
  { source: 'google_trends',     weight: 0.20, analyzer: analyzeSearchInterest },
];

// ─── Aggregation logic ────────────────────────────────────────────

/**
 * Map a 0–100 score to a recommendation label.
 */
function scoreToRecommendation(score: number): AggregateSignalResult['recommendation'] {
  if (score >= 80) return 'strong_buy';
  if (score >= 60) return 'buy';
  if (score >= 40) return 'hold';
  if (score >= 20) return 'sell';
  return 'strong_sell';
}

/**
 * Calculate agreement-adjusted confidence.
 * High confidence when signals agree; drops when they conflict.
 */
function calculateAgreementConfidence(signals: SignalResult[]): number {
  if (signals.length === 0) return 0;

  // Count directional agreement
  const directionCounts = { bullish: 0, bearish: 0, neutral: 0 };
  for (const s of signals) {
    directionCounts[s.direction]++;
  }

  const maxAgreement = Math.max(directionCounts.bullish, directionCounts.bearish, directionCounts.neutral);
  const agreementRatio = maxAgreement / signals.length;

  // Average raw confidence from individual signals
  const avgConfidence = signals.reduce((s, sig) => s + sig.confidence, 0) / signals.length;

  // Agreement amplifies confidence, disagreement suppresses it
  return Math.round(avgConfidence * (0.5 + agreementRatio * 0.5) * 100) / 100;
}

/**
 * Build a human-readable rationale from signal results.
 */
function buildRationale(
  signals: SignalResult[],
  overallScore: number,
  recommendation: string,
): string {
  const parts: string[] = [];

  // Overall summary
  const direction = overallScore >= 60 ? 'bullish' : overallScore <= 40 ? 'bearish' : 'mixed';
  parts.push(`Overall outlook: ${direction} (score ${overallScore}/100, rec: ${recommendation}).`);

  // Per-signal summaries
  for (const signal of signals) {
    const label = signalLabel(signal.source);
    parts.push(`${label} [${signal.score}/100]: ${signal.reasoning}`);
  }

  return parts.join(' | ');
}

function signalLabel(source: SignalSource): string {
  const labels: Record<SignalSource, string> = {
    pe_ratio: 'Valuation',
    price_trend: 'Trend',
    social_sentiment: 'Sentiment',
    news_sentiment: 'News',
    google_trends: 'Search Interest',
    macro_trend: 'Macro',
  };
  return labels[source] || source;
}

// ─── Main export ──────────────────────────────────────────────────

/**
 * Run ALL signal analysers for a stock, aggregate weighted scores.
 *
 * Weights: Valuation 35%, Trend 25%, Sentiment 20%, Search Interest 20%
 *
 * Returns overall confidence score (0–100), combined rationale, and
 * a composite score mapped to -1..+1 for the analysis_logs table.
 */
export async function analyzeStock(
  stock: Stock,
  marketData: MarketData,
  customWeights?: { source: SignalSource; weight: number }[],
): Promise<AggregateSignalResult> {
  // Apply custom weights if provided (from learning engine adjustments)
  const pipeline = customWeights
    ? SIGNAL_PIPELINE.map(p => ({
        ...p,
        weight: customWeights.find(w => w.source === p.source)?.weight ?? p.weight,
      }))
    : SIGNAL_PIPELINE;

  // Normalise weights to sum to 1
  const totalWeight = pipeline.reduce((s, p) => s + p.weight, 0);
  const normalised = pipeline.map(p => ({ ...p, weight: p.weight / totalWeight }));

  // Run all signal analysers in parallel
  const signalPromises = normalised.map(async (config) => {
    try {
      return await config.analyzer(stock, marketData);
    } catch (err: any) {
      console.error(`[Signals] ${config.source} failed for ${stock.symbol}:`, err.message);
      // Return a neutral fallback on error
      return {
        source: config.source,
        score: 50,
        confidence: 0.1,
        direction: 'neutral' as const,
        reasoning: `Signal analysis failed: ${err.message}`,
        breakdown: { error: err.message },
      };
    }
  });

  const signals = await Promise.all(signalPromises);

  // Calculate weighted composite score (0–100)
  const weightedBreakdown = normalised.map((config, i) => ({
    source: config.source,
    weight: Math.round(config.weight * 100) / 100,
    score: signals[i].score,
    weightedScore: Math.round(signals[i].score * config.weight * 100) / 100,
    direction: signals[i].direction,
  }));

  const overallScore = Math.max(0, Math.min(100, Math.round(
    weightedBreakdown.reduce((s, wb) => s + wb.weightedScore, 0),
  )));

  // Map 0–100 to -1..+1 for DB compatibility
  const compositeScore = Math.round(((overallScore - 50) / 50) * 100) / 100;

  const overallConfidence = calculateAgreementConfidence(signals);
  const recommendation = scoreToRecommendation(overallScore);

  const direction = overallScore >= 60 ? 'bullish' as const
    : overallScore <= 40 ? 'bearish' as const
    : 'neutral' as const;

  const rationale = buildRationale(signals, overallScore, recommendation);

  return {
    overallScore,
    overallConfidence,
    direction,
    recommendation,
    compositeScore,
    signals,
    rationale,
    weightedBreakdown,
  };
}

export { analyzeValuation } from './valuationSignal';
export { analyzeTrend } from './trendSignal';
export { analyzeSentiment } from './sentimentSignal';
export { analyzeSearchInterest } from './searchInterestSignal';
