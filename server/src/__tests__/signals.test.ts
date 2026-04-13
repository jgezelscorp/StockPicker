/**
 * Signal Analysis Tests
 *
 * Tests signal scoring, direction classification, weighted aggregation,
 * and edge cases around missing or partial data.
 */
import { describe, it, expect } from 'vitest';

// ─── Types matching shared/src/types.ts ─────────────────────────

type SignalSource =
  | 'pe_ratio'
  | 'price_trend'
  | 'macro_trend'
  | 'google_trends'
  | 'social_sentiment'
  | 'news_sentiment';

type SignalDirection = 'bullish' | 'bearish' | 'neutral';

interface SignalInput {
  source: SignalSource;
  direction: SignalDirection;
  strength: number; // 0–1
  value: number | null;
}

interface SignalWeight {
  source: SignalSource;
  weight: number;
}

// ─── Default weights from architecture ──────────────────────────

const DEFAULT_WEIGHTS: SignalWeight[] = [
  { source: 'pe_ratio',          weight: 0.20 },
  { source: 'price_trend',       weight: 0.20 },
  { source: 'macro_trend',       weight: 0.15 },
  { source: 'google_trends',     weight: 0.10 },
  { source: 'social_sentiment',  weight: 0.15 },
  { source: 'news_sentiment',    weight: 0.20 },
];

// ─── Pure-logic helpers (what the real services should implement) ─

/** Map direction to a numeric multiplier: bullish=+1, bearish=-1, neutral=0 */
function directionMultiplier(d: SignalDirection): number {
  return d === 'bullish' ? 1 : d === 'bearish' ? -1 : 0;
}

/** Compute weighted composite score from a set of signals. Returns –1 … +1 */
function computeCompositeScore(signals: SignalInput[], weights: SignalWeight[]): number {
  let score = 0;
  let totalWeight = 0;

  for (const w of weights) {
    const sig = signals.find(s => s.source === w.source);
    if (!sig) continue; // missing signal → skip, re-distribute weight
    score += directionMultiplier(sig.direction) * sig.strength * w.weight;
    totalWeight += w.weight;
  }

  return totalWeight > 0 ? score / totalWeight : 0;
}

/** Confidence = agreement across available signals. More agreement → higher confidence. */
function computeConfidence(signals: SignalInput[]): number {
  if (signals.length === 0) return 0;
  const directions = signals.map(s => directionMultiplier(s.direction));
  const avgDirection = directions.reduce((a, b) => a + b, 0) / directions.length;
  // Agreement measure: how close to unanimous (|avgDir| near 1)
  const agreement = Math.abs(avgDirection);
  // Weighted by average strength
  const avgStrength = signals.reduce((a, s) => a + s.strength, 0) / signals.length;
  return agreement * avgStrength;
}

/** Classify P/E ratio as a valuation signal */
function valuationSignal(pe: number, sectorAvgPe: number): SignalInput {
  const ratio = pe / sectorAvgPe;
  let direction: SignalDirection;
  let strength: number;

  if (ratio < 0.8) {
    direction = 'bullish';
    strength = Math.min(1, (0.8 - ratio) / 0.4 + 0.5);
  } else if (ratio > 1.2) {
    direction = 'bearish';
    strength = Math.min(1, (ratio - 1.2) / 0.4 + 0.5);
  } else {
    direction = 'neutral';
    strength = 0.3;
  }

  return { source: 'pe_ratio', direction, strength, value: pe };
}

/** Classify price trend using moving averages */
function trendSignal(ma50: number, ma200: number): SignalInput {
  const ratio = ma50 / ma200;

  if (ratio > 1.02) {
    // Golden cross territory
    return { source: 'price_trend', direction: 'bullish', strength: Math.min(1, (ratio - 1) * 5), value: ratio };
  } else if (ratio < 0.98) {
    // Death cross territory
    return { source: 'price_trend', direction: 'bearish', strength: Math.min(1, (1 - ratio) * 5), value: ratio };
  }
  return { source: 'price_trend', direction: 'neutral', strength: 0.2, value: ratio };
}

/** Classify sentiment score (–1 to +1 raw) */
function sentimentSignal(rawScore: number, source: 'social_sentiment' | 'news_sentiment'): SignalInput {
  const direction: SignalDirection = rawScore > 0.2 ? 'bullish' : rawScore < -0.2 ? 'bearish' : 'neutral';
  const strength = Math.min(1, Math.abs(rawScore));
  return { source, direction, strength, value: rawScore };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Signal Analysis', () => {

  // ── Valuation signal ───────────────────────────────────────────

  describe('Valuation signal (P/E)', () => {
    it('should return bullish with high strength for undervalued stock', () => {
      const sig = valuationSignal(10, 20); // P/E far below sector avg
      expect(sig.direction).toBe('bullish');
      expect(sig.strength).toBeGreaterThan(0.5);
    });

    it('should return bearish for overvalued stock', () => {
      const sig = valuationSignal(40, 20); // P/E double sector avg
      expect(sig.direction).toBe('bearish');
      expect(sig.strength).toBeGreaterThan(0.5);
    });

    it('should return neutral for fairly valued stock', () => {
      const sig = valuationSignal(20, 20); // P/E at sector avg
      expect(sig.direction).toBe('neutral');
    });
  });

  // ── Trend signal ───────────────────────────────────────────────

  describe('Trend signal (moving averages)', () => {
    it('should detect golden cross (50d > 200d) as bullish', () => {
      const sig = trendSignal(110, 100); // 50d well above 200d
      expect(sig.direction).toBe('bullish');
      expect(sig.strength).toBeGreaterThan(0.3);
    });

    it('should detect death cross (50d < 200d) as bearish', () => {
      const sig = trendSignal(90, 100); // 50d well below 200d
      expect(sig.direction).toBe('bearish');
      expect(sig.strength).toBeGreaterThan(0.3);
    });

    it('should return neutral when MAs are close together', () => {
      const sig = trendSignal(100, 100);
      expect(sig.direction).toBe('neutral');
    });
  });

  // ── Sentiment signal ───────────────────────────────────────────

  describe('Sentiment signal', () => {
    it('should score positive news as bullish with high strength', () => {
      const sig = sentimentSignal(0.8, 'news_sentiment');
      expect(sig.direction).toBe('bullish');
      expect(sig.strength).toBeGreaterThanOrEqual(0.8);
    });

    it('should score negative news as bearish', () => {
      const sig = sentimentSignal(-0.7, 'news_sentiment');
      expect(sig.direction).toBe('bearish');
      expect(sig.strength).toBeGreaterThanOrEqual(0.7);
    });

    it('should score neutral-ish sentiment as neutral', () => {
      const sig = sentimentSignal(0.1, 'social_sentiment');
      expect(sig.direction).toBe('neutral');
    });

    it('should clamp strength to 1.0 for extreme scores', () => {
      const sig = sentimentSignal(1.5, 'news_sentiment');
      expect(sig.strength).toBeLessThanOrEqual(1.0);
    });
  });

  // ── Signal aggregation ─────────────────────────────────────────

  describe('Signal aggregation', () => {
    it('should compute correct weighted average', () => {
      const signals: SignalInput[] = [
        { source: 'pe_ratio',          direction: 'bullish', strength: 0.8, value: null },
        { source: 'price_trend',       direction: 'bullish', strength: 0.7, value: null },
        { source: 'macro_trend',       direction: 'neutral', strength: 0.5, value: null },
        { source: 'google_trends',     direction: 'bullish', strength: 0.6, value: null },
        { source: 'social_sentiment',  direction: 'bullish', strength: 0.9, value: null },
        { source: 'news_sentiment',    direction: 'bullish', strength: 0.75, value: null },
      ];

      const score = computeCompositeScore(signals, DEFAULT_WEIGHTS);

      // Manual: (0.8*0.20 + 0.7*0.20 + 0*0.15 + 0.6*0.10 + 0.9*0.15 + 0.75*0.20) / 1.0
      const expected = (0.16 + 0.14 + 0 + 0.06 + 0.135 + 0.15) / 1.0;
      expect(score).toBeCloseTo(expected, 4);
    });

    it('should produce score in [–1, +1] range', () => {
      // All bullish, max strength
      const allBullish: SignalInput[] = DEFAULT_WEIGHTS.map(w => ({
        source: w.source, direction: 'bullish' as SignalDirection, strength: 1.0, value: null,
      }));
      expect(computeCompositeScore(allBullish, DEFAULT_WEIGHTS)).toBeCloseTo(1.0, 4);

      // All bearish, max strength
      const allBearish: SignalInput[] = DEFAULT_WEIGHTS.map(w => ({
        source: w.source, direction: 'bearish' as SignalDirection, strength: 1.0, value: null,
      }));
      expect(computeCompositeScore(allBearish, DEFAULT_WEIGHTS)).toBeCloseTo(-1.0, 4);
    });

    it('should produce near-zero score when signals conflict equally', () => {
      const mixed: SignalInput[] = [
        { source: 'pe_ratio',          direction: 'bullish', strength: 0.8, value: null },
        { source: 'price_trend',       direction: 'bearish', strength: 0.8, value: null },
        { source: 'macro_trend',       direction: 'bullish', strength: 0.8, value: null },
        { source: 'google_trends',     direction: 'bearish', strength: 0.8, value: null },
        { source: 'social_sentiment',  direction: 'bullish', strength: 0.8, value: null },
        { source: 'news_sentiment',    direction: 'bearish', strength: 0.8, value: null },
      ];
      const score = computeCompositeScore(mixed, DEFAULT_WEIGHTS);
      // Weights: bull = 0.20+0.15+0.15 = 0.50, bear = 0.20+0.10+0.20 = 0.50
      // Score should be near zero but slightly biased
      expect(Math.abs(score)).toBeLessThan(0.15);
    });

    it('should calculate high confidence when signals agree', () => {
      const agreeing: SignalInput[] = DEFAULT_WEIGHTS.map(w => ({
        source: w.source, direction: 'bullish' as SignalDirection, strength: 0.9, value: null,
      }));
      const conf = computeConfidence(agreeing);
      expect(conf).toBeGreaterThan(0.7);
    });

    it('should calculate low confidence when signals disagree', () => {
      const conflicting: SignalInput[] = [
        { source: 'pe_ratio',          direction: 'bullish',  strength: 0.8, value: null },
        { source: 'price_trend',       direction: 'bearish',  strength: 0.8, value: null },
        { source: 'macro_trend',       direction: 'bullish',  strength: 0.8, value: null },
        { source: 'google_trends',     direction: 'bearish',  strength: 0.8, value: null },
        { source: 'social_sentiment',  direction: 'bullish',  strength: 0.8, value: null },
        { source: 'news_sentiment',    direction: 'bearish',  strength: 0.8, value: null },
      ];
      const conf = computeConfidence(conflicting);
      expect(conf).toBeLessThan(0.3);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle missing signals gracefully (re-weight remaining)', () => {
      const partial: SignalInput[] = [
        { source: 'pe_ratio',    direction: 'bullish', strength: 0.8, value: null },
        { source: 'price_trend', direction: 'bullish', strength: 0.7, value: null },
      ];
      const score = computeCompositeScore(partial, DEFAULT_WEIGHTS);
      // Only pe_ratio(0.20) + price_trend(0.20) contribute, totalWeight = 0.40
      // score = (0.8*0.20 + 0.7*0.20) / 0.40 = (0.16 + 0.14) / 0.40 = 0.75
      expect(score).toBeCloseTo(0.75, 4);
      expect(score).toBeGreaterThanOrEqual(-1);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('should return 0 when no signals are available', () => {
      const score = computeCompositeScore([], DEFAULT_WEIGHTS);
      expect(score).toBe(0);
    });

    it('should return 0 confidence when no signals are available', () => {
      const conf = computeConfidence([]);
      expect(conf).toBe(0);
    });

    it('should handle single signal correctly', () => {
      const single: SignalInput[] = [
        { source: 'news_sentiment', direction: 'bearish', strength: 0.9, value: null },
      ];
      const score = computeCompositeScore(single, DEFAULT_WEIGHTS);
      // –0.9 * 0.20 / 0.20 = –0.9
      expect(score).toBeCloseTo(-0.9, 4);
    });

    it('should handle all neutral signals', () => {
      const neutral: SignalInput[] = DEFAULT_WEIGHTS.map(w => ({
        source: w.source, direction: 'neutral' as SignalDirection, strength: 0.5, value: null,
      }));
      const score = computeCompositeScore(neutral, DEFAULT_WEIGHTS);
      expect(score).toBe(0); // neutral direction = multiplier 0
    });
  });
});
