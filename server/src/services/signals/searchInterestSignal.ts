import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';

// ─── Scoring logic ────────────────────────────────────────────────

/**
 * Score search interest using real Google Trends data from MarketData.
 *
 * Key principles:
 * - Rising interest → bullish (retail attention often precedes buying pressure)
 * - Falling interest → bearish (waning enthusiasm)
 * - Stable → neutral
 * - Magnitude matters: +50% is stronger than +10%
 * - Contrarian: very high absolute interest (>80) + falling = peak attention passed
 * - Very high absolute interest (>80) alone can be contrarian bearish
 */
function scoreSearchTrend(
  data: NonNullable<MarketData['searchTrend']>,
): { score: number; confidence: number } {
  const { trend, changePercent, currentInterest } = data;
  let score: number;

  if (trend === 'rising') {
    // Rising: base 60, scaled by magnitude of change
    const magnitudeBonus = Math.min(30, Math.abs(changePercent) * 0.6);
    score = 60 + magnitudeBonus;

    // Contrarian check: extremely high interest may mean "everyone already knows"
    if (currentInterest > 80) {
      score -= 10; // dampen — peak retail attention is often a top signal
    }
  } else if (trend === 'falling') {
    // Falling: base 40, scaled by magnitude
    const magnitudePenalty = Math.min(30, Math.abs(changePercent) * 0.6);
    score = 40 - magnitudePenalty;

    // Contrarian: extremely high + falling = peak has passed (extra bearish)
    if (currentInterest > 80) {
      score -= 5;
    }
  } else {
    // Stable: slight lean based on absolute interest level
    score = 45 + Math.min(10, currentInterest / 10);

    // Very high stable interest → slight contrarian bearish lean
    if (currentInterest > 80) {
      score -= 5;
    }
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Confidence: stronger trends = more decisive signal
  const trendStrength = Math.min(1, Math.abs(changePercent) / 50);
  const baseConfidence = trend === 'stable' ? 0.3 : 0.45;
  const confidence = Math.round(Math.min(1, baseConfidence + trendStrength * 0.4) * 100) / 100;

  return { score, confidence };
}

// ─── Main export ──────────────────────────────────────────────────

/**
 * Analyse search interest trends using real Google Trends data.
 * Score: 0–100 (higher = rising public interest = potential bullish)
 *
 * Graceful degradation: no searchTrend data → neutral with low confidence.
 */
export async function analyzeSearchInterest(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const searchTrend = marketData.searchTrend;

  // Graceful degradation: no search data
  if (!searchTrend) {
    return {
      source: 'google_trends',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: 'No search trend data available — returning neutral.',
      breakdown: { dataAvailable: false },
    };
  }

  const { score, confidence } = scoreSearchTrend(searchTrend);

  const direction = score >= 60 ? 'bullish' as const
    : score <= 40 ? 'bearish' as const
    : 'neutral' as const;

  const { trend, changePercent, currentInterest, previousInterest } = searchTrend;

  const trendDescription = trend === 'rising'
    ? `Search interest rising ${changePercent}% (${previousInterest} → ${currentInterest})`
    : trend === 'falling'
      ? `Search interest falling ${Math.abs(changePercent)}% (${previousInterest} → ${currentInterest})`
      : `Search interest stable around ${currentInterest}/100`;

  const contrarianNote = currentInterest > 80
    ? ' [Contrarian caution: very high absolute interest]'
    : '';

  return {
    source: 'google_trends',
    score,
    confidence,
    direction,
    reasoning: `${trendDescription}.${contrarianNote}`,
    breakdown: {
      currentInterest,
      previousInterest,
      trend,
      changePercent,
      contrarianFlag: currentInterest > 80,
      dataAvailable: true,
    },
  };
}
