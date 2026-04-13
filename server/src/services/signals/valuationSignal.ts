import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';

// ─── Default sector averages (fallback when real sector data unavailable) ──
// These are reasonable baseline estimates — real data from Yahoo Fundamentals
// is weighted much higher when available.
const SECTOR_DEFAULTS: Record<string, { pe: number; pb: number; dividendYield: number }> = {
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

// Market cap tiers affect valuation expectations
const enum CapTier { Mega, Large, Mid, Small, Micro }

function classifyMarketCap(cap: number | undefined): CapTier {
  if (!cap || cap <= 0) return CapTier.Mid; // default to mid if unknown
  if (cap >= 200e9) return CapTier.Mega;
  if (cap >= 10e9) return CapTier.Large;
  if (cap >= 2e9) return CapTier.Mid;
  if (cap >= 300e6) return CapTier.Small;
  return CapTier.Micro;
}

// Mega/large caps trade at premium P/E; small caps at discount
function capTierPeAdjustment(tier: CapTier): number {
  switch (tier) {
    case CapTier.Mega:  return 1.15;
    case CapTier.Large: return 1.05;
    case CapTier.Mid:   return 1.00;
    case CapTier.Small: return 0.90;
    case CapTier.Micro: return 0.80;
  }
}

/**
 * Score a single valuation metric against its sector average.
 * Returns 0–100 where higher = more undervalued = more bullish.
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
    // Dividend yield: higher than avg → bullish
    rawScore = ratio >= 1
      ? 50 + Math.min((ratio - 1) * 100, 50)
      : 50 - Math.min((1 - ratio) * 100, 50);
  } else {
    // P/E and P/B: lower than avg → undervalued → bullish
    rawScore = ratio <= 1
      ? 50 + Math.min((1 - ratio) * 100, 50)
      : 50 - Math.min((ratio - 1) * 50, 50);
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const confidence = Math.min(1, 0.5 + Math.abs(ratio - 1) * 0.5);
  const label = score > 55 ? 'undervalued' : score < 45 ? 'overvalued' : 'fairly valued';

  return {
    score,
    confidence: Math.round(confidence * 100) / 100,
    detail: `${value.toFixed(2)} vs sector avg ${sectorAvg.toFixed(2)} (${label})`,
  };
}

/**
 * Score position within the 52-week range.
 * Near 52-week low with decent fundamentals → potential value opportunity.
 */
function score52WeekPosition(
  currentPrice: number | undefined,
  week52High: number | undefined,
  week52Low: number | undefined,
): { score: number; confidence: number; detail: string } {
  if (!currentPrice || !week52High || !week52Low || week52High <= week52Low) {
    return { score: 50, confidence: 0.1, detail: 'no 52-week data' };
  }

  const range = week52High - week52Low;
  const position = (currentPrice - week52Low) / range; // 0 = at low, 1 = at high

  // Near the low → potentially undervalued (bullish), near high → potentially stretched
  // Map: position 0 → score ~70 (near low = value), position 1 → score ~30 (near high = stretched)
  const score = Math.round(70 - position * 40);
  const confidence = 0.5; // moderate — price position alone isn't definitive

  const pctFromLow = ((currentPrice - week52Low) / week52Low * 100).toFixed(1);
  const pctFromHigh = ((week52High - currentPrice) / week52High * 100).toFixed(1);

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    detail: `${pctFromLow}% above 52w low, ${pctFromHigh}% below 52w high`,
  };
}

/**
 * Score revenue growth and profit margin as growth-quality signals.
 */
function scoreGrowthQuality(
  revenueGrowth: number | undefined,
  profitMargin: number | undefined,
): { score: number; confidence: number; detail: string } {
  const parts: string[] = [];
  let totalScore = 0;
  let count = 0;

  if (revenueGrowth !== undefined) {
    // Revenue growth: >20% → very bullish, 0–10% → neutral, <0% → bearish
    const revScore = Math.max(0, Math.min(100, Math.round(50 + revenueGrowth * 150)));
    totalScore += revScore;
    count++;
    parts.push(`rev growth ${(revenueGrowth * 100).toFixed(1)}%`);
  }

  if (profitMargin !== undefined) {
    // Profit margin: >20% → strong, 5–15% → decent, <0% → negative
    const marginScore = Math.max(0, Math.min(100, Math.round(40 + profitMargin * 200)));
    totalScore += marginScore;
    count++;
    parts.push(`margin ${(profitMargin * 100).toFixed(1)}%`);
  }

  if (count === 0) {
    return { score: 50, confidence: 0.1, detail: 'no growth data' };
  }

  return {
    score: Math.round(totalScore / count),
    confidence: Math.round((0.3 + count * 0.2) * 100) / 100,
    detail: parts.join(', '),
  };
}

/**
 * Analyse a stock's valuation using real fundamental data from Yahoo Finance.
 * Score: 0–100 (higher = more undervalued = more bullish)
 *
 * Confidence reflects how much real data is available:
 * - All 3 core metrics (P/E, P/B, div yield) → high confidence
 * - 1–2 metrics → medium confidence
 * - No real data → low confidence, neutral result
 */
export async function analyzeValuation(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const sector = stock.sector || 'Unknown';
  const sectorAvg = SECTOR_DEFAULTS[sector] || MARKET_AVERAGE;
  const capTier = classifyMarketCap(marketData.marketCap);

  // Adjust sector P/E expectation by market cap tier
  const adjustedSectorPe = sectorAvg.pe * capTierPeAdjustment(capTier);

  const peRatio = marketData.peRatio ?? null;
  const pbRatio = marketData.pbRatio ?? null;
  const dividendYield = marketData.dividendYield ?? null;

  const peResult = scoreMetric(peRatio, adjustedSectorPe, false);
  const pbResult = scoreMetric(pbRatio, sectorAvg.pb, false);
  const divResult = scoreMetric(dividendYield, sectorAvg.dividendYield, true);

  const weekResult = score52WeekPosition(
    marketData.currentPrice, marketData.week52High, marketData.week52Low,
  );
  const growthResult = scoreGrowthQuality(
    marketData.revenueGrowth, marketData.profitMargin,
  );

  // Count how many core metrics we have real data for
  const coreMetrics = [peRatio, pbRatio, dividendYield].filter(v => v !== null && v > 0);
  const coreCount = coreMetrics.length;
  const hasSupplemental = (marketData.week52High != null) ||
    (marketData.revenueGrowth != null) || (marketData.profitMargin != null);

  // If zero real data, return neutral with low confidence
  if (coreCount === 0 && !hasSupplemental) {
    return {
      source: 'pe_ratio',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: 'No valuation data available — returning neutral.',
      breakdown: { metricsAvailable: 0, sectorUsed: sector },
    };
  }

  // Weighted combination — core metrics dominate, supplementals add nuance
  // Core: P/E 30%, P/B 20%, Div 15%  |  Supplemental: 52-week 20%, Growth 15%
  const w = { pe: 0.30, pb: 0.20, div: 0.15, week: 0.20, growth: 0.15 };

  const compositeScore = Math.round(
    peResult.score * w.pe
    + pbResult.score * w.pb
    + divResult.score * w.div
    + weekResult.score * w.week
    + growthResult.score * w.growth,
  );

  // Data confidence: scales with how much real data we have
  const dataConfidence = coreCount === 3 ? 0.85
    : coreCount === 2 ? 0.65
    : coreCount === 1 ? 0.45
    : 0.25; // only supplemental data

  // Boost slightly if supplemental data available
  const supplementalBoost = hasSupplemental ? 0.10 : 0;

  const avgMetricConfidence =
    peResult.confidence * w.pe
    + pbResult.confidence * w.pb
    + divResult.confidence * w.div
    + weekResult.confidence * w.week
    + growthResult.confidence * w.growth;

  const finalScore = Math.max(0, Math.min(100, compositeScore));
  const finalConfidence = Math.round(
    Math.min(1, Math.min(avgMetricConfidence, dataConfidence + supplementalBoost)) * 100,
  ) / 100;

  const reasonParts: string[] = [];
  if (peRatio !== null) reasonParts.push(`P/E: ${peResult.detail}`);
  if (pbRatio !== null) reasonParts.push(`P/B: ${pbResult.detail}`);
  if (dividendYield !== null) reasonParts.push(`Div: ${divResult.detail}`);
  if (weekResult.detail !== 'no 52-week data') reasonParts.push(`52w: ${weekResult.detail}`);
  if (growthResult.detail !== 'no growth data') reasonParts.push(`Growth: ${growthResult.detail}`);
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
      week52Score: weekResult.score,
      growthScore: growthResult.score,
      sectorUsed: sector,
      capTier: ['Mega', 'Large', 'Mid', 'Small', 'Micro'][capTier] ?? 'Unknown',
      metricsAvailable: coreCount,
      hasSupplementalData: hasSupplemental,
    },
  };
}
