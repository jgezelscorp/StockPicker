/**
 * Learning Engine Tests
 *
 * Tests decision evaluation, weight adjustment bounds,
 * learning report generation, and edge cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../db/schema';

// ─── Helpers ────────────────────────────────────────────────────

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

function insertStock(db: Database.Database, symbol = 'AAPL'): number {
  const r = db.prepare(
    "INSERT INTO stocks (symbol, name, market, asset_type, currency) VALUES (?, ?, 'US', 'stock', 'USD')"
  ).run(symbol, `${symbol} Inc`);
  return Number(r.lastInsertRowid);
}

function insertTrade(db: Database.Database, stockId: number, action: 'buy' | 'sell', qty: number, price: number, confidence: number): number {
  const r = db.prepare(`
    INSERT INTO trades (stock_id, action, quantity, price_per_share, total_value, confidence, rationale, signal_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, 'Auto trade', '{"pe_ratio": {"direction": "bullish", "strength": 0.8}}')
  `).run(stockId, action, qty, price, qty * price, confidence);
  return Number(r.lastInsertRowid);
}

function insertOutcome(
  db: Database.Database,
  tradeId: number,
  expected: number,
  actual: number,
  wasCorrect: boolean,
  holdingDays = 14,
  lessons = '{}',
) {
  db.prepare(`
    INSERT INTO learning_outcomes (trade_id, expected_return, actual_return, holding_days, was_correct, lessons_learned)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(tradeId, expected, actual, holdingDays, wasCorrect ? 1 : 0, lessons);
}

// ─── Weight adjustment logic (mirrors architecture spec) ────────

interface SignalWeight {
  source: string;
  weight: number;
}

const MAX_WEIGHT_ADJUSTMENT = 0.02; // ±2%

function adjustWeights(
  currentWeights: SignalWeight[],
  signalAccuracy: Record<string, number>, // source → accuracy 0-1
): SignalWeight[] {
  const avgAccuracy = Object.values(signalAccuracy).reduce((a, b) => a + b, 0) / Object.values(signalAccuracy).length || 0;

  return currentWeights.map(w => {
    const accuracy = signalAccuracy[w.source];
    if (accuracy === undefined) return w;

    const delta = (accuracy - avgAccuracy) * MAX_WEIGHT_ADJUSTMENT;
    const clamped = Math.max(-MAX_WEIGHT_ADJUSTMENT, Math.min(MAX_WEIGHT_ADJUSTMENT, delta));
    const newWeight = Math.max(0.01, Math.min(0.50, w.weight + clamped));

    return { ...w, weight: newWeight };
  });
}

/** Normalise weights so they sum to 1.0 */
function normaliseWeights(weights: SignalWeight[]): SignalWeight[] {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  return weights.map(w => ({ ...w, weight: w.weight / total }));
}

/** Evaluate a closed trade: was the prediction correct? */
function evaluateDecision(
  buyConfidence: number,
  buyPrice: number,
  sellPrice: number,
): { expectedReturn: number; actualReturn: number; wasCorrect: boolean } {
  const actualReturn = (sellPrice - buyPrice) / buyPrice;
  // If confidence was high (>0.72) and we bought, a positive return means correct
  const expectedReturn = buyConfidence * 0.2; // rough heuristic: higher confidence → higher expected
  const wasCorrect = actualReturn > 0;
  return { expectedReturn, actualReturn, wasCorrect };
}

/** Generate a learning report from outcomes */
function generateLearningReport(outcomes: any[]) {
  if (outcomes.length === 0) {
    return {
      totalEvaluated: 0,
      winRate: 0,
      avgExpectedReturn: 0,
      avgActualReturn: 0,
      predictionAccuracy: 0,
      recommendations: ['No trades to evaluate yet.'],
    };
  }

  const wins = outcomes.filter(o => o.was_correct || o.was_correct === 1);
  const winRate = (wins.length / outcomes.length) * 100;
  const avgExpected = outcomes.reduce((s: number, o: any) => s + o.expected_return, 0) / outcomes.length;
  const avgActual = outcomes.reduce((s: number, o: any) => s + o.actual_return, 0) / outcomes.length;

  // Prediction accuracy: how often direction was right
  const predictionAccuracy = winRate;

  const recommendations: string[] = [];
  if (winRate < 50) recommendations.push('Consider increasing confidence threshold');
  if (avgActual < avgExpected) recommendations.push('System is over-estimating returns');
  if (winRate > 70) recommendations.push('Strong performance — consider slightly larger positions');

  return {
    totalEvaluated: outcomes.length,
    winRate,
    avgExpectedReturn: avgExpected,
    avgActualReturn: avgActual,
    predictionAccuracy,
    recommendations,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('LearningEngine', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  // ── Decision evaluation ────────────────────────────────────────

  describe('Decision evaluation', () => {
    it('should log a correct prediction when stock goes up after buy', () => {
      const eval_ = evaluateDecision(0.85, 100, 120);
      expect(eval_.wasCorrect).toBe(true);
      expect(eval_.actualReturn).toBeCloseTo(0.20, 4);
      expect(eval_.expectedReturn).toBeCloseTo(0.17, 4); // 0.85 * 0.2
    });

    it('should log an incorrect prediction when stock drops after buy', () => {
      const eval_ = evaluateDecision(0.80, 100, 90);
      expect(eval_.wasCorrect).toBe(false);
      expect(eval_.actualReturn).toBeCloseTo(-0.10, 4);
    });

    it('should store evaluation in learning_outcomes table', () => {
      const sid = insertStock(db);
      const sellTradeId = insertTrade(db, sid, 'sell', 10, 130, 0.35);

      const eval_ = evaluateDecision(0.85, 100, 130);
      insertOutcome(db, sellTradeId, eval_.expectedReturn, eval_.actualReturn, eval_.wasCorrect);

      const outcome = db.prepare('SELECT * FROM learning_outcomes WHERE trade_id = ?').get(sellTradeId) as any;
      expect(outcome).toBeDefined();
      expect(outcome.was_correct).toBe(1);
      expect(outcome.actual_return).toBeCloseTo(0.30, 4);
    });
  });

  // ── Weight adjustment ──────────────────────────────────────────

  describe('Weight adjustment', () => {
    const baseWeights: SignalWeight[] = [
      { source: 'pe_ratio',          weight: 0.20 },
      { source: 'price_trend',       weight: 0.20 },
      { source: 'macro_trend',       weight: 0.15 },
      { source: 'google_trends',     weight: 0.10 },
      { source: 'social_sentiment',  weight: 0.15 },
      { source: 'news_sentiment',    weight: 0.20 },
    ];

    it('should stay within ±2% adjustment bounds', () => {
      const accuracy: Record<string, number> = {
        'pe_ratio': 0.90,          // much above average
        'price_trend': 0.30,       // much below average
        'macro_trend': 0.60,
        'google_trends': 0.50,
        'social_sentiment': 0.65,
        'news_sentiment': 0.55,
      };

      const adjusted = adjustWeights(baseWeights, accuracy);

      for (let i = 0; i < adjusted.length; i++) {
        const diff = Math.abs(adjusted[i].weight - baseWeights[i].weight);
        expect(diff).toBeLessThanOrEqual(MAX_WEIGHT_ADJUSTMENT + 0.0001);
      }
    });

    it('should increase weight for high-accuracy signals', () => {
      const accuracy: Record<string, number> = {
        'pe_ratio': 1.0,       // perfect
        'price_trend': 0.5,
        'macro_trend': 0.5,
        'google_trends': 0.5,
        'social_sentiment': 0.5,
        'news_sentiment': 0.5,
      };

      const adjusted = adjustWeights(baseWeights, accuracy);
      const peWeight = adjusted.find(w => w.source === 'pe_ratio')!.weight;
      expect(peWeight).toBeGreaterThan(0.20);
    });

    it('should decrease weight for low-accuracy signals', () => {
      const accuracy: Record<string, number> = {
        'pe_ratio': 0.0,       // terrible
        'price_trend': 0.5,
        'macro_trend': 0.5,
        'google_trends': 0.5,
        'social_sentiment': 0.5,
        'news_sentiment': 0.5,
      };

      const adjusted = adjustWeights(baseWeights, accuracy);
      const peWeight = adjusted.find(w => w.source === 'pe_ratio')!.weight;
      expect(peWeight).toBeLessThan(0.20);
    });

    it('should never let a weight drop below 1% or exceed 50%', () => {
      // Extreme scenario: run many adjustment rounds
      let weights = [...baseWeights];
      const extremeAccuracy: Record<string, number> = {
        'pe_ratio': 1.0,
        'price_trend': 0.0,
        'macro_trend': 0.0,
        'google_trends': 0.0,
        'social_sentiment': 0.0,
        'news_sentiment': 0.0,
      };

      for (let i = 0; i < 100; i++) {
        weights = adjustWeights(weights, extremeAccuracy);
      }

      for (const w of weights) {
        expect(w.weight).toBeGreaterThanOrEqual(0.01);
        expect(w.weight).toBeLessThanOrEqual(0.50);
      }
    });

    it('should produce normalised weights that sum to 1.0', () => {
      const accuracy: Record<string, number> = {
        'pe_ratio': 0.90, 'price_trend': 0.30,
        'macro_trend': 0.60, 'google_trends': 0.50,
        'social_sentiment': 0.65, 'news_sentiment': 0.55,
      };

      const adjusted = adjustWeights(baseWeights, accuracy);
      const normalised = normaliseWeights(adjusted);
      const sum = normalised.reduce((s, w) => s + w.weight, 0);
      expect(sum).toBeCloseTo(1.0, 6);
    });
  });

  // ── Learning report ────────────────────────────────────────────

  describe('Learning report generation', () => {
    it('should generate accurate report from outcomes', () => {
      const sid = insertStock(db);
      const t1 = insertTrade(db, sid, 'sell', 10, 130, 0.3);
      const t2 = insertTrade(db, sid, 'sell', 10, 80, 0.3);
      insertOutcome(db, t1, 0.15, 0.30, true);
      insertOutcome(db, t2, 0.15, -0.20, false);

      const outcomes = db.prepare('SELECT * FROM learning_outcomes').all();
      const report = generateLearningReport(outcomes);

      expect(report.totalEvaluated).toBe(2);
      expect(report.winRate).toBe(50);
      expect(report.avgExpectedReturn).toBeCloseTo(0.15, 4);
      expect(report.avgActualReturn).toBeCloseTo(0.05, 4);
    });

    it('should recommend increasing threshold when win rate is low', () => {
      const outcomes = [
        { expected_return: 0.10, actual_return: -0.05, was_correct: 0 },
        { expected_return: 0.10, actual_return: -0.08, was_correct: 0 },
        { expected_return: 0.10, actual_return: 0.02, was_correct: 1 },
      ];
      const report = generateLearningReport(outcomes);
      expect(report.winRate).toBeCloseTo(33.33, 0);
      expect(report.recommendations).toContain('Consider increasing confidence threshold');
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle no historical trades to evaluate', () => {
      const outcomes = db.prepare('SELECT * FROM learning_outcomes').all();
      const report = generateLearningReport(outcomes);

      expect(report.totalEvaluated).toBe(0);
      expect(report.winRate).toBe(0);
      expect(report.recommendations).toContain('No trades to evaluate yet.');
    });

    it('should handle all trades were losses', () => {
      const sid = insertStock(db);
      for (let i = 0; i < 5; i++) {
        const t = insertTrade(db, sid, 'sell', 10, 80 + i, 0.3);
        insertOutcome(db, t, 0.10, -(0.05 + i * 0.02), false);
      }

      const outcomes = db.prepare('SELECT * FROM learning_outcomes').all();
      const report = generateLearningReport(outcomes);

      expect(report.winRate).toBe(0);
      expect(report.avgActualReturn).toBeLessThan(0);
      expect(report.recommendations).toContain('Consider increasing confidence threshold');
    });

    it('should handle evaluation of single trade', () => {
      const sid = insertStock(db);
      const t = insertTrade(db, sid, 'sell', 10, 130, 0.3);
      insertOutcome(db, t, 0.10, 0.30, true);

      const outcomes = db.prepare('SELECT * FROM learning_outcomes').all();
      const report = generateLearningReport(outcomes);

      expect(report.totalEvaluated).toBe(1);
      expect(report.winRate).toBe(100);
    });
  });
});
