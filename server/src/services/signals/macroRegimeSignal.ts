/**
 * Macro Regime Signal
 * 
 * Classifies the current macroeconomic environment using real FRED data
 * and maps it to investment regime recommendations for ETF sector rotation.
 * 
 * Regimes:
 * - Growth: favor equities, cyclicals, tech, small-caps
 * - Slowdown: shift to defensive, quality, dividends
 * - Recession: favor bonds, gold, short positions, utilities
 * - Recovery: cyclicals, value, small-caps (early cycle)
 * - Stagflation: commodities, TIPS, real assets, avoid bonds
 * 
 * Input: FRED data (CPI, unemployment, yield curve, PMI, GDP)
 * Output: Signal score 0–100, regime classification, confidence
 */

import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';
import { fetchMacroIndicators, classifyMacroRegime, type MacroRegime } from '../data/fredClient';

// ─── Regime-to-Score Mapping ────────────────────────────────────

/** Base scores by regime — higher = more bullish for broad equities/ETFs */
const REGIME_BASE_SCORES: Record<MacroRegime, number> = {
  growth: 72,       // favorable for equities
  recovery: 65,     // early cycle, opportunities
  slowdown: 38,     // caution advised
  recession: 20,    // defensive posture
  stagflation: 30,  // worst environment for stocks
};

/**
 * Sector-specific regime adjustments.
 * Some ETFs benefit from specific regimes.
 */
const SECTOR_REGIME_ADJUSTMENTS: Record<string, Partial<Record<MacroRegime, number>>> = {
  // Defensive sectors outperform in downturns
  'Utilities':        { recession: +20, slowdown: +10, growth: -5 },
  'Consumer Staples': { recession: +15, slowdown: +10, growth: -3 },
  'Healthcare':       { recession: +10, slowdown: +5 },
  // Cyclicals outperform in growth/recovery
  'Technology':       { growth: +10, recovery: +8, recession: -10 },
  'Consumer Discretionary': { growth: +8, recovery: +10, recession: -15 },
  'Financials':       { growth: +5, recovery: +12, recession: -10 },
  'Industrials':      { growth: +5, recovery: +10, recession: -8 },
  // Real assets hedge inflation/stagflation
  'Energy':           { stagflation: +15, growth: +5, recession: -5 },
  'Materials':        { stagflation: +10, recovery: +8 },
  'Real Estate':      { growth: +5, stagflation: -10, recession: -12 },
};

// ─── Main Export ────────────────────────────────────────────────

/**
 * Analyze macroeconomic regime using FRED data.
 * 
 * This signal is designed primarily for ETFs but provides useful
 * context for stocks as well (just with lower weight in stock pipeline).
 */
export async function analyzeMacroRegime(
  stock: Stock,
  _marketData: MarketData,
): Promise<SignalResult> {
  try {
    const indicators = await fetchMacroIndicators();
    const classification = classifyMacroRegime(indicators);

    if (indicators.indicatorsLoaded === 0) {
      return {
        source: 'macro_trend',
        score: 50,
        confidence: 0.1,
        direction: 'neutral',
        reasoning: 'No FRED macro data available — configure FRED_API_KEY for real economic data.',
        breakdown: { regime: 'unknown', dataAvailable: false },
      };
    }

    // Base score from regime
    let score = REGIME_BASE_SCORES[classification.regime];

    // Apply sector-specific adjustments if we know the sector
    const sector = stock.sector || '';
    const sectorAdj = SECTOR_REGIME_ADJUSTMENTS[sector];
    if (sectorAdj && sectorAdj[classification.regime] !== undefined) {
      score += sectorAdj[classification.regime]!;
    }

    // Additional indicator-specific adjustments
    if (indicators.yieldCurveInverted) {
      score -= 8; // Inverted yield curve is a strong negative
    }
    if (indicators.unemploymentTrend === 'rising') {
      score -= 5;
    }
    if (indicators.cpiTrend === 'falling' && classification.regime !== 'recession') {
      score += 3; // Easing inflation is positive (unless already in recession)
    }
    if (indicators.claimsTrend === 'falling') {
      score += 3; // Improving labor market
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    // Confidence: FRED data reliability × classification clarity
    const dataQuality = Math.min(1, indicators.indicatorsLoaded / 5);
    const confidence = Math.round(
      Math.min(0.9, classification.confidence * 0.6 + dataQuality * 0.4) * 100,
    ) / 100;

    const direction = score >= 60 ? 'bullish' as const
      : score <= 40 ? 'bearish' as const
      : 'neutral' as const;

    const sectorNote = sectorAdj && sectorAdj[classification.regime]
      ? ` ${sector} sector ${sectorAdj[classification.regime]! > 0 ? 'benefits' : 'underperforms'} in ${classification.regime}.`
      : '';

    return {
      source: 'macro_trend',
      score,
      confidence,
      direction,
      reasoning: `Macro regime: ${classification.regime.toUpperCase()} (${(classification.confidence * 100).toFixed(0)}% confidence). ${classification.reasoning}${sectorNote}`,
      breakdown: {
        regime: classification.regime,
        regimeConfidence: classification.confidence,
        indicatorsLoaded: indicators.indicatorsLoaded,
        yieldCurveSpread: indicators.yieldCurveSpread,
        yieldCurveInverted: indicators.yieldCurveInverted,
        gdpGrowth: indicators.gdpGrowth,
        unemploymentRate: indicators.unemploymentRate,
        cpiYoY: indicators.cpiYoY,
        pmi: indicators.pmi,
        fedFundsRate: indicators.fedFundsRate,
        sectorAdjustment: sectorAdj?.[classification.regime] ?? 0,
        dataAsOf: indicators.dataAsOf,
        dataAvailable: true,
      },
    };
  } catch (err: any) {
    console.error(`[MacroRegime] Analysis failed: ${err.message}`);
    return {
      source: 'macro_trend',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: `Macro regime analysis error: ${err.message}`,
      breakdown: { error: err.message, dataAvailable: false },
    };
  }
}
