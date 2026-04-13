import type { Stock, Signal } from '../../types';
import type { SignalResult, MarketData } from './index';

// Mock sector averages — will be replaced with real API data later
const SECTOR_AVERAGES: Record<string, { pe: number; pb: number; dividendYield: number }> = {
  Technology:       { pe: 28.5, pb: 7.2,  dividendYield: 0.9 },
  Healthcare:       { pe: 22.0, pb: 4.5,  dividendYield: 1.4 },
  Financials:       { pe: 13.5, pb: 1.4,  dividendYield: 2.8 },
  'Consumer Discretionary': { pe: 25.0, pb: 5.0, dividendYield: 1.2 },
  'Consumer Staples':       { pe: 21.0, pb: 4.8, dividendYield: 2.5 },
  Energy:           { pe: 11.0, pb: 1.8,  dividendYield: 3.5 },
  Industrials:      { pe: 20.0, pb: 3.8,  dividendYield: 1.8 },
  Materials:        { pe: 16.0, pb: 2.5,  dividendYield: 2.0 },
  Utilities:        { pe: 17.0, pb: 1.9,  dividendYield: 3.2 },
  'Real Estate':    { pe: 35.0, pb: 2.2,  dividendYield: 3.8 },
  'Communication Services': { pe: 18.0, pb: 3.0, dividendYield: 1.1 },
};

const MARKET_AVERAGE = { pe: 20.0, pb: 3.5, dividendYield: 1.8 };

interface ValuationMetrics {
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
}

/**
 * Score a single valuation metric against its sector average.
 * Returns 0–100 where higher = more undervalued = more bullish.
 *
 * For P/E and P/B: stock below sector avg → undervalued → high score
 * For Dividend Yield: stock above sector avg → undervalued → high score
 */
function scoreMetric(
  value: number | null,
  sectorAvg: number,
  invertDirection: boolean,
): { score: number; confidence: number; detail: string } {
  if (value === null || value <= 0) {
    return { score: 50, confidence: 0.1, detail: 'no data' };
  }

  const ratio = value / sectorAvg;

  let rawScore: number;
  if (invertDirection) {
    // For dividend yield: higher than avg is bullish
    rawScore = ratio >= 1 ? 50 + Math.min((ratio - 1) * 100, 50) : 50 - Math.min((1 - ratio) * 100, 50);
  } else {
    // For P/E and P/B: lower than avg is bullish (undervalued)
    rawScore = ratio <= 1 ? 50 + Math.min((1 - ratio) * 100, 50) : 50 - Math.min((ratio - 1) * 50, 50);
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const confidence = Math.min(1, 0.5 + Math.abs(ratio - 1) * 0.5);
  const direction = score > 55 ? 'undervalued' : score < 45 ? 'overvalued' : 'fairly valued';

  return {
    score,
    confidence: Math.round(confidence * 100) / 100,
    detail: `${value.toFixed(2)} vs sector avg ${sectorAvg.toFixed(2)} (${direction})`,
  };
}

/**
 * Analyse a stock's valuation relative to sector averages.
 * Score: 0–100 (higher = more undervalued = more bullish)
 */
export async function analyzeValuation(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const sector = stock.sector || 'Unknown';
  const sectorAvg = SECTOR_AVERAGES[sector] || MARKET_AVERAGE;

  const metrics: ValuationMetrics = {
    peRatio: marketData.peRatio ?? null,
    pbRatio: marketData.pbRatio ?? null,
    dividendYield: marketData.dividendYield ?? null,
  };

  const peResult = scoreMetric(metrics.peRatio, sectorAvg.pe, false);
  const pbResult = scoreMetric(metrics.pbRatio, sectorAvg.pb, false);
  const divResult = scoreMetric(metrics.dividendYield, sectorAvg.dividendYield, true);

  // Weighted combination: P/E most important, then P/B, then dividend
  const weights = { pe: 0.45, pb: 0.30, div: 0.25 };
  const totalConfidence = peResult.confidence * weights.pe
    + pbResult.confidence * weights.pb
    + divResult.confidence * weights.div;

  const compositeScore = Math.round(
    peResult.score * weights.pe
    + pbResult.score * weights.pb
    + divResult.score * weights.div,
  );

  const availableMetrics = [metrics.peRatio, metrics.pbRatio, metrics.dividendYield]
    .filter(v => v !== null && v > 0).length;
  const dataConfidence = Math.max(0.1, availableMetrics / 3);

  const finalScore = Math.max(0, Math.min(100, compositeScore));
  const finalConfidence = Math.round(Math.min(totalConfidence, dataConfidence) * 100) / 100;

  const reasonParts: string[] = [];
  if (metrics.peRatio !== null) reasonParts.push(`P/E: ${peResult.detail}`);
  if (metrics.pbRatio !== null) reasonParts.push(`P/B: ${pbResult.detail}`);
  if (metrics.dividendYield !== null) reasonParts.push(`Div Yield: ${divResult.detail}`);
  if (reasonParts.length === 0) reasonParts.push('No valuation data available');

  const direction = finalScore >= 60 ? 'bullish' as const
    : finalScore <= 40 ? 'bearish' as const
    : 'neutral' as const;

  return {
    source: 'pe_ratio',
    score: finalScore,
    confidence: finalConfidence,
    direction,
    reasoning: `Valuation vs ${sector} sector: ${reasonParts.join('; ')}`,
    breakdown: {
      peScore: peResult.score,
      pbScore: pbResult.score,
      dividendScore: divResult.score,
      sectorUsed: sector,
      metricsAvailable: availableMetrics,
    },
  };
}
