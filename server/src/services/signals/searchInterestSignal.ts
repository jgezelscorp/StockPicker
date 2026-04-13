import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';

// ─── Search interest data interfaces ──────────────────────────────

interface SearchInterestData {
  currentInterest: number;     // 0–100 relative interest level
  previousInterest: number;    // level from comparison period
  trend: 'rising' | 'falling' | 'stable';
  changePercent: number;
  relatedQueries: string[];
}

// ─── Stubbed data fetch ───────────────────────────────────────────

/**
 * Fetch search interest data for a stock ticker.
 * STUB: Simulates Google Trends-style data without API key.
 *
 * In production, replace with:
 * - Google Trends unofficial API (pytrends proxy)
 * - SerpAPI Google Trends endpoint
 * - Custom scraping service
 */
async function fetchSearchInterest(symbol: string): Promise<SearchInterestData> {
  const seed = hashSymbol(symbol);

  // Simulate current vs previous period interest
  const baseInterest = 20 + (seed % 60);
  const variance = ((seed * 13) % 40) - 20;
  const currentInterest = Math.max(5, Math.min(100, baseInterest + variance));
  const previousInterest = Math.max(5, Math.min(100, baseInterest - variance * 0.3));

  const changePercent = previousInterest > 0
    ? Math.round(((currentInterest - previousInterest) / previousInterest) * 100)
    : 0;

  let trend: SearchInterestData['trend'] = 'stable';
  if (changePercent > 15) trend = 'rising';
  else if (changePercent < -15) trend = 'falling';

  const relatedQueries = generateRelatedQueries(symbol, seed);

  return {
    currentInterest,
    previousInterest,
    trend,
    changePercent,
    relatedQueries,
  };
}

/**
 * Generate plausible related search queries for a stock.
 */
function generateRelatedQueries(symbol: string, seed: number): string[] {
  const templates = [
    `${symbol} stock price`,
    `${symbol} earnings`,
    `${symbol} buy or sell`,
    `${symbol} analyst rating`,
    `${symbol} dividend`,
    `${symbol} stock forecast`,
    `${symbol} news today`,
    `is ${symbol} a good investment`,
  ];

  const count = 2 + (seed % 4);
  const selected: string[] = [];
  for (let i = 0; i < count; i++) {
    selected.push(templates[(seed + i * 3) % templates.length]);
  }
  return selected;
}

/**
 * Simple hash for deterministic mock data.
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
 * Score search interest based on trend direction and magnitude.
 *
 * Rising interest in a stock often precedes retail buying pressure.
 * Falling interest may indicate waning enthusiasm.
 *
 * Score: 0–100 (higher = rising public interest = potential bullish signal)
 */
function scoreSearchInterest(data: SearchInterestData): { score: number; confidence: number } {
  let score: number;

  if (data.trend === 'rising') {
    // Rising interest: score based on magnitude of increase
    const magnitudeBonus = Math.min(30, data.changePercent * 0.5);
    score = 60 + magnitudeBonus;

    // Very high absolute interest + rising = extra bullish (breakout territory)
    if (data.currentInterest > 75) score += 5;
  } else if (data.trend === 'falling') {
    // Falling interest: score based on magnitude of decrease
    const magnitudePenalty = Math.min(30, Math.abs(data.changePercent) * 0.5);
    score = 40 - magnitudePenalty;
  } else {
    // Stable: neutral score, slight bonus for high absolute interest
    score = 45 + Math.min(10, data.currentInterest / 10);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Confidence: stronger trends = more confident signal
  const trendStrength = Math.min(1, Math.abs(data.changePercent) / 50);
  const baseConfidence = data.trend === 'stable' ? 0.3 : 0.4;
  const confidence = Math.round(Math.min(1, baseConfidence + trendStrength * 0.4) * 100) / 100;

  return { score, confidence };
}

// ─── Main export ──────────────────────────────────────────────────

/**
 * Analyse search interest trends for a stock.
 * Score: 0–100 (higher = rising public interest)
 */
export async function analyzeSearchInterest(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const searchData = await fetchSearchInterest(stock.symbol);
  const { score, confidence } = scoreSearchInterest(searchData);

  const direction = score >= 60 ? 'bullish' as const
    : score <= 40 ? 'bearish' as const
    : 'neutral' as const;

  const trendDescription = searchData.trend === 'rising'
    ? `Search interest rising ${searchData.changePercent}% (${searchData.previousInterest} → ${searchData.currentInterest})`
    : searchData.trend === 'falling'
      ? `Search interest falling ${Math.abs(searchData.changePercent)}% (${searchData.previousInterest} → ${searchData.currentInterest})`
      : `Search interest stable around ${searchData.currentInterest}/100`;

  return {
    source: 'google_trends',
    score,
    confidence,
    direction,
    reasoning: `${trendDescription}. Top queries: "${searchData.relatedQueries.slice(0, 2).join('", "')}".`,
    breakdown: {
      currentInterest: searchData.currentInterest,
      previousInterest: searchData.previousInterest,
      trend: searchData.trend,
      changePercent: searchData.changePercent,
      relatedQueries: searchData.relatedQueries,
    },
  };
}
