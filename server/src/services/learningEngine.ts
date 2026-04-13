import { getDb } from '../db';
import type { SignalSource } from '../types';

// ─── Types ────────────────────────────────────────────────────────

export interface DecisionAccuracy {
  totalEvaluated: number;
  winRate: number;             // percentage
  avgReturn: number;           // percentage
  avgHoldingDays: number;
  signalAccuracy: Record<string, {
    avgScore: number;
    correctWhenBullish: number;
    correctWhenBearish: number;
    totalPredictions: number;
  }>;
}

export interface WeightAdjustment {
  source: SignalSource;
  oldWeight: number;
  newWeight: number;
  reason: string;
}

export interface LearningReport {
  evaluatedSince: string;
  accuracy: DecisionAccuracy;
  weightAdjustments: WeightAdjustment[];
  currentWeights: { source: SignalSource; weight: number }[];
  insights: string[];
}

interface TradeWithOutcome {
  tradeId: number;
  stockId: number;
  symbol: string;
  action: string;
  confidence: number;
  signalSnapshot: string;
  executedAt: string;
  buyPrice: number;
  sellPrice: number;
  actualReturn: number;
  holdingDays: number;
  wasCorrect: boolean;
}

// ─── Weight storage key in system_state ───────────────────────────

const WEIGHTS_KEY = 'signal_weights';
const MAX_ADJUSTMENT = 0.02;  // ±2% per learning cycle
const MIN_WEIGHT = 0.05;      // no signal drops below 5%
const MAX_WEIGHT = 0.50;      // no signal exceeds 50%

const DEFAULT_WEIGHTS: Record<SignalSource, number> = {
  pe_ratio: 0.35,
  price_trend: 0.25,
  social_sentiment: 0.20,
  google_trends: 0.20,
  // These exist in the type system but aren't in our pipeline yet
  news_sentiment: 0,
  macro_trend: 0,
};

// ─── Core functions ───────────────────────────────────────────────

/**
 * Get current signal weights from the database, or defaults.
 */
export function getCurrentWeights(): Record<SignalSource, number> {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM system_state WHERE key = ?").get(WEIGHTS_KEY) as any;
    if (row?.value) {
      const parsed = JSON.parse(row.value);
      return { ...DEFAULT_WEIGHTS, ...parsed };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_WEIGHTS };
}

/**
 * Save signal weights to the database.
 */
function saveWeights(weights: Record<SignalSource, number>): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO system_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(WEIGHTS_KEY, JSON.stringify(weights));
}

/**
 * Evaluate past trading decisions — look at trades from 30+ days ago
 * and compare predicted outcomes (based on signals) vs actual returns.
 */
export function evaluatePastDecisions(): TradeWithOutcome[] {
  const db = getDb();

  // Find sell trades from 30+ days ago that haven't been evaluated by the learning engine
  const unevaluatedSells = db.prepare(`
    SELECT t.id as tradeId, t.stock_id as stockId, s.symbol, t.action,
           t.confidence, t.signal_snapshot as signalSnapshot,
           t.executed_at as executedAt, t.price_per_share as sellPrice
    FROM trades t
    JOIN stocks s ON s.id = t.stock_id
    WHERE t.action = 'sell'
      AND t.executed_at <= datetime('now', '-30 days')
      AND t.id NOT IN (SELECT trade_id FROM learning_outcomes)
    ORDER BY t.executed_at ASC
  `).all() as any[];

  const outcomes: TradeWithOutcome[] = [];

  for (const sell of unevaluatedSells) {
    // Find the matching buy trade
    const buy = db.prepare(`
      SELECT price_per_share, executed_at, confidence, signal_snapshot
      FROM trades
      WHERE stock_id = ? AND action = 'buy' AND executed_at < ?
      ORDER BY executed_at DESC LIMIT 1
    `).get(sell.stockId, sell.executedAt) as any;

    if (!buy) continue;

    const holdingDays = Math.max(1, Math.round(
      (new Date(sell.executedAt).getTime() - new Date(buy.executed_at).getTime())
      / (1000 * 60 * 60 * 24),
    ));

    const actualReturn = ((sell.sellPrice - buy.price_per_share) / buy.price_per_share) * 100;
    const wasCorrect = actualReturn > 0;

    // Record the learning outcome in the DB
    const expectedReturn = buy.confidence * 10;  // simplified mapping
    const lessons = JSON.stringify({
      symbol: sell.symbol,
      buyConfidence: buy.confidence,
      sellConfidence: sell.confidence,
      actualReturn: Math.round(actualReturn * 100) / 100,
      holdingDays,
      outcome: wasCorrect ? 'profitable' : 'loss',
      buySignals: safeJsonParse(buy.signal_snapshot),
      sellSignals: safeJsonParse(sell.signalSnapshot),
    });

    db.prepare(`
      INSERT INTO learning_outcomes
        (trade_id, expected_return, actual_return, holding_days, was_correct, lessons_learned)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sell.tradeId, expectedReturn, actualReturn, holdingDays, wasCorrect ? 1 : 0, lessons);

    outcomes.push({
      tradeId: sell.tradeId,
      stockId: sell.stockId,
      symbol: sell.symbol,
      action: sell.action,
      confidence: sell.confidence,
      signalSnapshot: sell.signalSnapshot,
      executedAt: sell.executedAt,
      buyPrice: buy.price_per_share,
      sellPrice: sell.sellPrice,
      actualReturn: Math.round(actualReturn * 100) / 100,
      holdingDays,
      wasCorrect,
    });
  }

  if (outcomes.length > 0) {
    console.log(`[Learning] Evaluated ${outcomes.length} past decisions`);
  }

  return outcomes;
}

/**
 * Get overall decision accuracy metrics including per-signal breakdown.
 */
export function getDecisionAccuracy(): DecisionAccuracy {
  const db = getDb();

  const outcomes = db.prepare(`
    SELECT lo.*, t.confidence, t.signal_snapshot
    FROM learning_outcomes lo
    JOIN trades t ON t.id = lo.trade_id
    ORDER BY lo.evaluated_at DESC
  `).all() as any[];

  if (outcomes.length === 0) {
    return {
      totalEvaluated: 0,
      winRate: 0,
      avgReturn: 0,
      avgHoldingDays: 0,
      signalAccuracy: {},
    };
  }

  const wins = outcomes.filter((o: any) => o.was_correct);
  const winRate = Math.round((wins.length / outcomes.length) * 10000) / 100;
  const avgReturn = Math.round(
    outcomes.reduce((s: number, o: any) => s + o.actual_return, 0) / outcomes.length * 100,
  ) / 100;
  const avgHoldingDays = Math.round(
    outcomes.reduce((s: number, o: any) => s + o.holding_days, 0) / outcomes.length,
  );

  // Per-signal accuracy analysis
  const signalAccuracy: DecisionAccuracy['signalAccuracy'] = {};
  const signalSources: SignalSource[] = ['pe_ratio', 'price_trend', 'social_sentiment', 'google_trends', 'news_sentiment', 'macro_trend'];

  for (const source of signalSources) {
    let correctBullish = 0;
    let totalBullish = 0;
    let correctBearish = 0;
    let totalBearish = 0;
    let totalScore = 0;
    let count = 0;

    for (const outcome of outcomes) {
      const snapshot = safeJsonParse(outcome.signal_snapshot);
      if (!snapshot) continue;

      // Look for this signal source in the snapshot
      const signalData = findSignalInSnapshot(snapshot, source);
      if (!signalData) continue;

      count++;
      totalScore += signalData.score ?? (signalData.strength != null ? signalData.strength * 100 : 50);

      if (signalData.direction === 'bullish') {
        totalBullish++;
        if (outcome.was_correct) correctBullish++;
      } else if (signalData.direction === 'bearish') {
        totalBearish++;
        if (!outcome.was_correct) correctBearish++;  // bearish + loss = correct prediction
      }
    }

    if (count > 0) {
      signalAccuracy[source] = {
        avgScore: Math.round(totalScore / count * 100) / 100,
        correctWhenBullish: totalBullish > 0 ? Math.round((correctBullish / totalBullish) * 10000) / 100 : 0,
        correctWhenBearish: totalBearish > 0 ? Math.round((correctBearish / totalBearish) * 10000) / 100 : 0,
        totalPredictions: count,
      };
    }
  }

  return {
    totalEvaluated: outcomes.length,
    winRate,
    avgReturn,
    avgHoldingDays,
    signalAccuracy,
  };
}

/**
 * Adjust signal weights based on which signals were most predictive.
 * Conservative approach: ±2% max per cycle, weights bounded [5%, 50%].
 */
export function adjustWeights(outcomes?: TradeWithOutcome[]): WeightAdjustment[] {
  const accuracy = getDecisionAccuracy();
  if (accuracy.totalEvaluated < 5) {
    console.log('[Learning] Not enough data to adjust weights (need 5+ evaluated trades)');
    return [];
  }

  const currentWeights = getCurrentWeights();
  const adjustments: WeightAdjustment[] = [];
  const activeSourcesEntries = Object.entries(currentWeights).filter(([, w]) => w > 0);

  // Calculate accuracy score for each active signal
  const sourceScores: { source: SignalSource; accuracyScore: number }[] = [];

  for (const [source, weight] of activeSourcesEntries) {
    const signalAcc = accuracy.signalAccuracy[source];
    if (!signalAcc || signalAcc.totalPredictions < 3) continue;

    // Combine bullish and bearish accuracy into an overall score
    const bullishWeight = signalAcc.correctWhenBullish > 0 ? 1 : 0;
    const bearishWeight = signalAcc.correctWhenBearish > 0 ? 1 : 0;
    const totalWeights = bullishWeight + bearishWeight;

    const accuracyScore = totalWeights > 0
      ? (signalAcc.correctWhenBullish * bullishWeight + signalAcc.correctWhenBearish * bearishWeight) / totalWeights
      : 50;

    sourceScores.push({ source: source as SignalSource, accuracyScore });
  }

  if (sourceScores.length < 2) {
    console.log('[Learning] Not enough signal diversity for weight adjustment');
    return [];
  }

  // Find avg accuracy, adjust weights toward better-performing signals
  const avgAccuracy = sourceScores.reduce((s, ss) => s + ss.accuracyScore, 0) / sourceScores.length;

  const newWeights = { ...currentWeights };

  for (const { source, accuracyScore } of sourceScores) {
    const delta = accuracyScore - avgAccuracy;
    // Scale adjustment: positive delta → increase weight, capped at MAX_ADJUSTMENT
    const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, delta / 100 * 0.05));

    const oldWeight = currentWeights[source];
    let newWeight = Math.round((oldWeight + adjustment) * 1000) / 1000;
    newWeight = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, newWeight));

    if (Math.abs(newWeight - oldWeight) > 0.001) {
      newWeights[source] = newWeight;
      adjustments.push({
        source,
        oldWeight: Math.round(oldWeight * 1000) / 1000,
        newWeight,
        reason: `Accuracy ${accuracyScore.toFixed(1)}% vs avg ${avgAccuracy.toFixed(1)}% → ${adjustment > 0 ? 'increase' : 'decrease'} by ${Math.abs(adjustment * 100).toFixed(1)}%`,
      });
    }
  }

  // Renormalise active weights to sum to 1
  if (adjustments.length > 0) {
    const activeTotal = Object.entries(newWeights)
      .filter(([, w]) => w > 0)
      .reduce((s, [, w]) => s + w, 0);

    if (activeTotal > 0) {
      for (const [source, weight] of Object.entries(newWeights)) {
        if (weight > 0) {
          newWeights[source as SignalSource] = Math.round((weight / activeTotal) * 1000) / 1000;
        }
      }
    }

    saveWeights(newWeights);
    console.log(`[Learning] Adjusted ${adjustments.length} signal weights`);
  }

  return adjustments;
}

/**
 * Generate a comprehensive learning report.
 */
export function getLearningReport(): LearningReport {
  const accuracy = getDecisionAccuracy();
  const currentWeights = getCurrentWeights();
  const adjustments = adjustWeights();

  const insights: string[] = [];

  // Generate insights from accuracy data
  if (accuracy.totalEvaluated === 0) {
    insights.push('No trades evaluated yet — learning system awaiting data.');
  } else {
    if (accuracy.winRate >= 60) {
      insights.push(`Strong win rate of ${accuracy.winRate}% — strategy performing well.`);
    } else if (accuracy.winRate >= 45) {
      insights.push(`Win rate at ${accuracy.winRate}% — acceptable but room for improvement.`);
    } else {
      insights.push(`Low win rate of ${accuracy.winRate}% — strategy needs review.`);
    }

    if (accuracy.avgReturn > 0) {
      insights.push(`Average return of ${accuracy.avgReturn}% per trade is positive.`);
    } else {
      insights.push(`Average return of ${accuracy.avgReturn}% — losses outweigh wins.`);
    }

    // Find best and worst performing signals
    const signalEntries = Object.entries(accuracy.signalAccuracy);
    if (signalEntries.length > 0) {
      const sorted = signalEntries.sort((a, b) => {
        const aScore = (a[1].correctWhenBullish + a[1].correctWhenBearish) / 2;
        const bScore = (b[1].correctWhenBullish + b[1].correctWhenBearish) / 2;
        return bScore - aScore;
      });

      const best = sorted[0];
      const worst = sorted[sorted.length - 1];

      if (best) {
        insights.push(`Best signal: ${signalLabel(best[0])} with ${best[1].correctWhenBullish}% bullish accuracy.`);
      }
      if (worst && best && worst[0] !== best[0]) {
        insights.push(`Weakest signal: ${signalLabel(worst[0])} — consider investigating data quality.`);
      }
    }

    if (accuracy.avgHoldingDays > 30) {
      insights.push(`Average holding period of ${accuracy.avgHoldingDays} days — could benefit from quicker exits.`);
    }
  }

  const activeWeights = Object.entries(currentWeights)
    .filter(([, w]) => w > 0)
    .map(([source, weight]) => ({ source: source as SignalSource, weight }));

  return {
    evaluatedSince: new Date(Date.now() - 90 * 24 * 3600000).toISOString(),
    accuracy,
    weightAdjustments: adjustments,
    currentWeights: activeWeights,
    insights,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function safeJsonParse(str: string | null): any {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function findSignalInSnapshot(snapshot: any, source: SignalSource): any {
  if (Array.isArray(snapshot)) {
    return snapshot.find((s: any) => s.source === source);
  }
  if (snapshot?.signals && Array.isArray(snapshot.signals)) {
    return snapshot.signals.find((s: any) => s.source === source);
  }
  if (snapshot?.[source]) {
    return snapshot[source];
  }
  return null;
}

function signalLabel(source: string): string {
  const labels: Record<string, string> = {
    pe_ratio: 'Valuation (P/E)',
    price_trend: 'Price Trend',
    social_sentiment: 'Social Sentiment',
    google_trends: 'Search Interest',
    news_sentiment: 'News Sentiment',
    macro_trend: 'Macro Trend',
  };
  return labels[source] || source;
}
