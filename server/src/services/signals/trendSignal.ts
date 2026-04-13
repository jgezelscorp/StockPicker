import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';

interface MovingAverageAnalysis {
  sma50: number;
  sma200: number;
  crossoverSignal: 'golden_cross' | 'death_cross' | 'above_both' | 'below_both' | 'between';
  momentumScore: number;
}

interface VolumeAnalysis {
  avgVolume: number;
  recentVolume: number;
  volumeRatio: number;
  trendAlignment: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Analyse moving average crossover signals.
 * Golden cross (50 > 200) = bullish, death cross (50 < 200) = bearish.
 */
function analyzeMovingAverages(marketData: MarketData): MovingAverageAnalysis {
  const prices = marketData.priceHistory || [];
  const currentPrice = marketData.currentPrice || 0;

  // Calculate SMAs from price history, or use provided values
  const sma50 = marketData.sma50 ?? calculateSMA(prices, 50);
  const sma200 = marketData.sma200 ?? calculateSMA(prices, 200);

  if (sma50 === 0 && sma200 === 0) {
    return { sma50, sma200, crossoverSignal: 'between', momentumScore: 50 };
  }

  // Partial data: if only SMA50 available (50–199 days of history), use price vs SMA50
  if (sma200 === 0 && sma50 > 0 && currentPrice > 0) {
    const priceVsSma50 = (currentPrice - sma50) / sma50;
    const momentumScore = Math.max(0, Math.min(100, Math.round(50 + priceVsSma50 * 200)));
    const crossoverSignal = priceVsSma50 > 0.02 ? 'above_both' as const
      : priceVsSma50 < -0.02 ? 'below_both' as const
      : 'between' as const;
    return { sma50, sma200: 0, crossoverSignal, momentumScore };
  }

  let crossoverSignal: MovingAverageAnalysis['crossoverSignal'];
  let momentumScore: number;

  const maSpread = (sma50 - sma200) / sma200;
  const priceVsSma50 = currentPrice > 0 ? (currentPrice - sma50) / sma50 : 0;

  if (sma50 > sma200 && priceVsSma50 > 0) {
    // Price above both MAs — strong uptrend
    crossoverSignal = 'above_both';
    momentumScore = 65 + Math.min(maSpread * 200, 35);
  } else if (sma50 > sma200) {
    // Golden cross but price between MAs — moderate bullish
    crossoverSignal = 'golden_cross';
    momentumScore = 55 + Math.min(maSpread * 150, 20);
  } else if (sma50 < sma200 && priceVsSma50 < 0) {
    // Price below both MAs — strong downtrend
    crossoverSignal = 'below_both';
    momentumScore = 35 - Math.min(Math.abs(maSpread) * 200, 35);
  } else if (sma50 < sma200) {
    // Death cross but price between MAs — moderate bearish
    crossoverSignal = 'death_cross';
    momentumScore = 45 - Math.min(Math.abs(maSpread) * 150, 20);
  } else {
    crossoverSignal = 'between';
    momentumScore = 50;
  }

  return {
    sma50,
    sma200,
    crossoverSignal,
    momentumScore: Math.max(0, Math.min(100, Math.round(momentumScore))),
  };
}

/**
 * Analyse volume trends — increasing volume on up days is bullish.
 */
function analyzeVolume(marketData: MarketData): VolumeAnalysis {
  const prices = marketData.priceHistory || [];
  const volumes = marketData.volumeHistory || [];

  if (volumes.length < 5 || prices.length < 5) {
    return {
      avgVolume: 0,
      recentVolume: 0,
      volumeRatio: 1,
      trendAlignment: 'neutral',
    };
  }

  // Average volume over longer period
  const avgVolume = volumes.reduce((s, v) => s + v, 0) / volumes.length;
  // Recent volume (last 5 days)
  const recentSlice = volumes.slice(-5);
  const recentVolume = recentSlice.reduce((s, v) => s + v, 0) / recentSlice.length;
  const volumeRatio = avgVolume > 0 ? recentVolume / avgVolume : 1;

  // Check if volume is increasing on up-days vs down-days
  const recentPrices = prices.slice(-10);
  let upDayVolume = 0;
  let downDayVolume = 0;
  let upDays = 0;
  let downDays = 0;

  const recentVols = volumes.slice(-10);
  for (let i = 1; i < recentPrices.length && i < recentVols.length; i++) {
    if (recentPrices[i] > recentPrices[i - 1]) {
      upDayVolume += recentVols[i];
      upDays++;
    } else if (recentPrices[i] < recentPrices[i - 1]) {
      downDayVolume += recentVols[i];
      downDays++;
    }
  }

  const avgUpVol = upDays > 0 ? upDayVolume / upDays : 0;
  const avgDownVol = downDays > 0 ? downDayVolume / downDays : 0;

  let trendAlignment: VolumeAnalysis['trendAlignment'] = 'neutral';
  if (avgUpVol > avgDownVol * 1.2) trendAlignment = 'bullish';
  else if (avgDownVol > avgUpVol * 1.2) trendAlignment = 'bearish';

  return { avgVolume, recentVolume, volumeRatio, trendAlignment };
}

/**
 * Calculate Simple Moving Average from a price array.
 */
function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / slice.length;
}

/**
 * Analyse price trend and momentum for a stock.
 * Score: 0–100 (higher = stronger bullish trend)
 */
export async function analyzeTrend(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const maAnalysis = analyzeMovingAverages(marketData);
  const volumeAnalysis = analyzeVolume(marketData);

  // Price momentum: recent price change (short-term)
  const prices = marketData.priceHistory || [];
  let shortTermMomentum = 50;
  if (prices.length >= 5) {
    const recent = prices[prices.length - 1];
    const fiveDaysAgo = prices[prices.length - 5];
    const changePct = fiveDaysAgo > 0 ? ((recent - fiveDaysAgo) / fiveDaysAgo) * 100 : 0;
    shortTermMomentum = Math.max(0, Math.min(100, 50 + changePct * 5));
  }

  // Volume confirmation bonus/penalty
  let volumeAdjustment = 0;
  if (volumeAnalysis.trendAlignment === 'bullish' && maAnalysis.momentumScore > 50) {
    volumeAdjustment = Math.min(10, (volumeAnalysis.volumeRatio - 1) * 15);
  } else if (volumeAnalysis.trendAlignment === 'bearish' && maAnalysis.momentumScore < 50) {
    volumeAdjustment = -Math.min(10, (volumeAnalysis.volumeRatio - 1) * 15);
  }

  // Composite: MA analysis (60%), short-term momentum (25%), volume confirmation (15%)
  const rawScore =
    maAnalysis.momentumScore * 0.60
    + shortTermMomentum * 0.25
    + (50 + volumeAdjustment * 2.5) * 0.15;

  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Confidence based on data availability and signal agreement
  const hasMA = maAnalysis.sma50 > 0 && maAnalysis.sma200 > 0;
  const hasVolume = volumeAnalysis.avgVolume > 0;
  const hasPrice = prices.length >= 5;
  const dataPoints = [hasMA, hasVolume, hasPrice].filter(Boolean).length;
  const baseConfidence = dataPoints / 3;

  // Higher confidence when signals agree
  const maDirection = maAnalysis.momentumScore > 55 ? 1 : maAnalysis.momentumScore < 45 ? -1 : 0;
  const volDirection = volumeAnalysis.trendAlignment === 'bullish' ? 1
    : volumeAnalysis.trendAlignment === 'bearish' ? -1 : 0;
  const agreement = maDirection !== 0 && maDirection === volDirection ? 0.15 : 0;

  const confidence = Math.round(Math.min(1, baseConfidence + agreement) * 100) / 100;

  const direction = finalScore >= 60 ? 'bullish' as const
    : finalScore <= 40 ? 'bearish' as const
    : 'neutral' as const;

  const crossoverText: Record<string, string> = {
    golden_cross: 'Golden cross (50 > 200 SMA) — bullish trend',
    death_cross: 'Death cross (50 < 200 SMA) — bearish trend',
    above_both: 'Price above both SMAs — strong uptrend',
    below_both: 'Price below both SMAs — strong downtrend',
    between: 'MAs converging — no clear trend',
  };

  const volumeText = volumeAnalysis.trendAlignment !== 'neutral'
    ? `Volume ${volumeAnalysis.volumeRatio.toFixed(1)}x avg, ${volumeAnalysis.trendAlignment} alignment`
    : 'Volume neutral';

  return {
    source: 'price_trend',
    score: finalScore,
    confidence,
    direction,
    reasoning: `${crossoverText[maAnalysis.crossoverSignal]}. ${volumeText}. Short-term momentum ${shortTermMomentum > 55 ? 'positive' : shortTermMomentum < 45 ? 'negative' : 'flat'}.`,
    breakdown: {
      crossoverSignal: maAnalysis.crossoverSignal,
      sma50: maAnalysis.sma50,
      sma200: maAnalysis.sma200,
      momentumScore: maAnalysis.momentumScore,
      shortTermMomentum: Math.round(shortTermMomentum),
      volumeRatio: Math.round(volumeAnalysis.volumeRatio * 100) / 100,
      volumeAlignment: volumeAnalysis.trendAlignment,
    },
  };
}
