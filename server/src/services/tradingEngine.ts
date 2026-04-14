import { getDb } from '../db';
import {
  DEFAULT_SIGNAL_WEIGHTS,
  DEFAULT_SCHEDULER_CONFIG,
  type SignalWeight,
} from '../types';
import type { SignalDirection, SignalSource, TradeAction } from '@apex/shared';

// ─── Types ──────────────────────────────────────────────────────

export interface SignalInput {
  source: SignalSource;
  direction: SignalDirection;
  strength: number; // 0–1
  value?: number | null;
  metadata?: string | null;
}

export interface EvaluationResult {
  compositeScore: number;    // –1 (strong sell) … +1 (strong buy)
  confidence: number;        // 0–1 (agreement among signals)
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  signalBreakdown: Record<string, { direction: string; strength: number; weighted: number }>;
  rationale: string;
}

export interface TradeDecision {
  shouldTrade: boolean;
  action: TradeAction;
  quantity: number;
  reason: string;
}

export interface TradeOrder {
  stockId: number;
  symbol: string;
  action: TradeAction;
  quantity: number;
  pricePerShare: number;
  confidence: number;
  rationale: string;
  signalSnapshot: string; // JSON
}

// ─── Asset-Type Thresholds ──────────────────────────────────────

interface AssetThresholds {
  stopLossPct: number;
  sellConfidenceThreshold: number;
  protectiveSellComposite: number;
  minTradeConfidence: number;
  maxPositionPct: number;
  minHoldingDays: number;
  // Conviction tier boundaries (confidence → multiplier)
  convictionTiers: { min: number; multiplier: number; label: string }[];
}

const STOCK_THRESHOLDS: AssetThresholds = {
  stopLossPct: -8,
  sellConfidenceThreshold: 0.40,
  protectiveSellComposite: -0.1,
  minTradeConfidence: 0.55,
  maxPositionPct: 0.15,
  minHoldingDays: 0, // stocks can sell any time
  convictionTiers: [
    { min: 0.85, multiplier: 1.0,  label: 'full conviction' },
    { min: 0.75, multiplier: 0.85, label: 'standard' },
    { min: 0.65, multiplier: 0.65, label: 'medium' },
    { min: 0.00, multiplier: 0.40, label: 'small (toe in the water)' },
  ],
};

const ETF_THRESHOLDS: AssetThresholds = {
  stopLossPct: -15,               // ETFs are diversified; wider stop-loss
  sellConfidenceThreshold: 0.50,  // higher sell conviction required
  protectiveSellComposite: -0.25, // stronger bearish signal needed for protective sell
  minTradeConfidence: 0.60,       // higher bar to enter ETF positions
  maxPositionPct: 0.20,           // larger positions OK — diversified by nature
  minHoldingDays: 14,             // enforce minimum holding period
  convictionTiers: [
    { min: 0.85, multiplier: 1.0,  label: 'full conviction (ETF)' },
    { min: 0.75, multiplier: 0.85, label: 'standard (ETF)' },
    { min: 0.65, multiplier: 0.70, label: 'medium (ETF)' },
    { min: 0.00, multiplier: 0.50, label: 'starter (ETF long-horizon)' },
  ],
};

function getThresholds(assetType: string): AssetThresholds {
  return assetType === 'etf' ? ETF_THRESHOLDS : STOCK_THRESHOLDS;
}

const MIN_CASH_RESERVE_PCT = 0.10;
const STARTING_CAPITAL = 100_000;

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Aggregate multiple signals into a composite score and confidence level.
 * Score: –1 (strong sell) to +1 (strong buy)
 * Confidence: 0–1 (how much signals agree)
 */
export function evaluateSignals(
  symbol: string,
  signals: SignalInput[],
  weights: SignalWeight[] = DEFAULT_SIGNAL_WEIGHTS
): EvaluationResult {
  if (signals.length === 0) {
    return {
      compositeScore: 0,
      confidence: 0,
      recommendation: 'hold',
      signalBreakdown: {},
      rationale: `No signals available for ${symbol}`,
    };
  }

  const weightMap = new Map(weights.map(w => [w.source, w.weight]));
  const breakdown: EvaluationResult['signalBreakdown'] = {};
  let totalWeight = 0;
  let weightedSum = 0;
  const directions: number[] = [];

  for (const signal of signals) {
    const weight = weightMap.get(signal.source) ?? 0.10;
    // Convert direction + strength to a –1…+1 directional value
    let dirValue = 0;
    if (signal.direction === 'bullish') dirValue = signal.strength;
    else if (signal.direction === 'bearish') dirValue = -signal.strength;
    // neutral = 0

    const weighted = dirValue * weight;
    weightedSum += weighted;
    totalWeight += weight;
    directions.push(dirValue);

    breakdown[signal.source] = {
      direction: signal.direction,
      strength: signal.strength,
      weighted: Number(weighted.toFixed(4)),
    };
  }

  // Normalise composite score to –1…+1
  const compositeScore = totalWeight > 0
    ? Math.max(-1, Math.min(1, weightedSum / totalWeight))
    : 0;

  // Confidence = agreement among signals
  // If all signals point the same direction, confidence is high
  // We measure this as 1 – (stddev of directional values / max possible stddev)
  const mean = directions.reduce((s, d) => s + d, 0) / directions.length;
  const variance = directions.reduce((s, d) => s + (d - mean) ** 2, 0) / directions.length;
  const stddev = Math.sqrt(variance);
  // Max stddev when half are +1 and half are –1 = 1.0
  const confidence = Math.max(0, Math.min(1, 1 - stddev));

  // Map to recommendation
  const recommendation = scoreToRecommendation(compositeScore, confidence);

  // Build human-readable rationale
  const bullishCount = signals.filter(s => s.direction === 'bullish').length;
  const bearishCount = signals.filter(s => s.direction === 'bearish').length;
  const neutralCount = signals.filter(s => s.direction === 'neutral').length;

  const rationale = [
    `${symbol}: composite=${compositeScore.toFixed(3)}, confidence=${(confidence * 100).toFixed(1)}%.`,
    `Signals: ${bullishCount} bullish, ${bearishCount} bearish, ${neutralCount} neutral.`,
    `Recommendation: ${recommendation.replace('_', ' ').toUpperCase()}.`,
    confidence >= DEFAULT_SCHEDULER_CONFIG.minTradeConfidence
      ? 'Confidence meets trading threshold.'
      : 'Confidence below trading threshold — hold.',
  ].join(' ');

  return {
    compositeScore: Number(compositeScore.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    recommendation,
    signalBreakdown: breakdown,
    rationale,
  };
}

function scoreToRecommendation(
  score: number,
  confidence: number
): EvaluationResult['recommendation'] {
  if (confidence < 0.3) return 'hold';
  if (score >= 0.6) return 'strong_buy';
  if (score >= 0.2) return 'buy';
  if (score <= -0.6) return 'strong_sell';
  if (score <= -0.2) return 'sell';
  return 'hold';
}

/**
 * Decision logic: should we buy this stock/ETF?
 * Uses asset-type-aware thresholds — ETFs have higher confidence bars
 * but allow larger positions (diversified instruments).
 */
export function shouldBuy(
  symbol: string,
  evaluation: EvaluationResult,
  currentPrice: number,
  assetType: string = 'stock'
): TradeDecision {
  const db = getDb();
  const config = DEFAULT_SCHEDULER_CONFIG;
  const thresholds = getThresholds(assetType);
  const tag = assetType === 'etf' ? '[ETF]' : '[Stock]';

  // Check confidence threshold (ETFs: 60%, stocks: 55%)
  if (evaluation.confidence < thresholds.minTradeConfidence) {
    return {
      shouldTrade: false, action: 'buy', quantity: 0,
      reason: `${tag} Confidence ${(evaluation.confidence * 100).toFixed(1)}% below ${assetType} threshold ${thresholds.minTradeConfidence * 100}%`,
    };
  }

  // Must be a buy/strong_buy recommendation, OR a hold with bullish lean + high confidence
  const isBuyOrStrongBuy = evaluation.recommendation === 'buy' || evaluation.recommendation === 'strong_buy';
  const isSoftBuy = evaluation.recommendation === 'hold' && 
                    evaluation.compositeScore > 0.15 && 
                    evaluation.confidence >= thresholds.minTradeConfidence + 0.05;

  if (!isBuyOrStrongBuy && !isSoftBuy) {
    return {
      shouldTrade: false, action: 'buy', quantity: 0,
      reason: `${tag} Recommendation is ${evaluation.recommendation}, not a buy signal (composite: ${evaluation.compositeScore.toFixed(3)})`,
    };
  }

  // Check if we already hold this asset
  const existingPos = db.prepare(
    "SELECT pp.quantity FROM portfolio_positions pp JOIN stocks s ON s.id = pp.stock_id WHERE s.symbol = ? AND pp.quantity > 0"
  ).get(symbol) as any;
  if (existingPos) {
    return {
      shouldTrade: false, action: 'buy', quantity: 0,
      reason: `Already holding ${existingPos.quantity} shares of ${symbol}`,
    };
  }

  // Check open position count
  const posCount = (db.prepare(
    'SELECT COUNT(*) as cnt FROM portfolio_positions WHERE quantity > 0'
  ).get() as any).cnt;
  if (posCount >= config.maxOpenPositions) {
    return {
      shouldTrade: false, action: 'buy', quantity: 0,
      reason: `At max positions (${config.maxOpenPositions})`,
    };
  }

  // Calculate position size — ETFs get larger max allocation (20% vs 15%)
  const totalValue = getPortfolioValue();
  const maxPositionValue = totalValue * thresholds.maxPositionPct;
  const cashBalance = getCashBalance();
  const minCashReserve = totalValue * MIN_CASH_RESERVE_PCT;
  const availableCash = Math.max(0, cashBalance - minCashReserve);

  if (availableCash < currentPrice) {
    return {
      shouldTrade: false, action: 'buy', quantity: 0,
      reason: `Insufficient cash ($${availableCash.toFixed(2)} available after reserve)`,
    };
  }

  // Tiered position sizing using asset-type-specific conviction tiers
  let convictionMultiplier = thresholds.convictionTiers[thresholds.convictionTiers.length - 1].multiplier;
  let sizeLabel = thresholds.convictionTiers[thresholds.convictionTiers.length - 1].label;

  for (const tier of thresholds.convictionTiers) {
    if (evaluation.confidence >= tier.min) {
      convictionMultiplier = tier.multiplier;
      sizeLabel = tier.label;
      break;
    }
  }

  const targetValue = Math.min(maxPositionValue * convictionMultiplier, availableCash);
  const quantity = Math.floor(targetValue / currentPrice);

  if (quantity <= 0) {
    return {
      shouldTrade: false, action: 'buy', quantity: 0,
      reason: `Calculated quantity is 0 (price $${currentPrice}, budget $${targetValue.toFixed(2)})`,
    };
  }

  return {
    shouldTrade: true,
    action: 'buy',
    quantity,
    reason: `${tag} Buy signal: confidence ${(evaluation.confidence * 100).toFixed(1)}%, ${evaluation.recommendation}. ${sizeLabel} position: ${quantity} shares @ $${currentPrice.toFixed(2)} = $${(quantity * currentPrice).toFixed(2)} (maxPos=${(thresholds.maxPositionPct * 100).toFixed(0)}%)`,
  };
}

/**
 * Decision logic: should we sell a held position?
 * ETFs use wider stop-loss, minimum holding period, and require
 * stronger bearish conviction before selling.
 */
export function shouldSell(
  symbol: string,
  evaluation: EvaluationResult,
  currentPrice: number,
  assetType: string = 'stock'
): TradeDecision {
  const db = getDb();
  const thresholds = getThresholds(assetType);
  const tag = assetType === 'etf' ? '[ETF]' : '[Stock]';

  const position = db.prepare(`
    SELECT pp.*, s.symbol FROM portfolio_positions pp
    JOIN stocks s ON s.id = pp.stock_id
    WHERE s.symbol = ? AND pp.quantity > 0
  `).get(symbol) as any;

  if (!position) {
    return {
      shouldTrade: false, action: 'sell', quantity: 0,
      reason: `No open position in ${symbol}`,
    };
  }

  const pnlPct = position.average_cost > 0
    ? ((currentPrice - position.average_cost) / position.average_cost) * 100
    : 0;

  // Minimum holding period check (ETFs: 14 days, stocks: 0)
  if (thresholds.minHoldingDays > 0 && position.opened_at) {
    const openedAt = new Date(position.opened_at);
    const now = new Date();
    const daysHeld = (now.getTime() - openedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysHeld < thresholds.minHoldingDays) {
      // Only override if NOT a catastrophic stop-loss (use 2x the normal stop-loss as emergency exit)
      const emergencyStopLoss = thresholds.stopLossPct * 2; // e.g., -30% for ETFs
      if (pnlPct > emergencyStopLoss) {
        return {
          shouldTrade: false, action: 'sell', quantity: 0,
          reason: `${tag} Minimum holding period: ${daysHeld.toFixed(0)}/${thresholds.minHoldingDays} days. P&L ${pnlPct.toFixed(2)}% within tolerance. Holding.`,
        };
      }
      // If past emergency stop-loss, fall through and sell anyway
      console.log(`[TradingEngine] ${tag} ${symbol}: Emergency stop-loss override — ${pnlPct.toFixed(2)}% loss exceeds ${emergencyStopLoss}% during holding period`);
    }
  }

  // Stop-loss check (ETFs: -15%, stocks: -8%)
  if (pnlPct <= thresholds.stopLossPct) {
    return {
      shouldTrade: true,
      action: 'sell',
      quantity: position.quantity,
      reason: `${tag} STOP-LOSS triggered: P&L ${pnlPct.toFixed(2)}% exceeds ${thresholds.stopLossPct}% threshold`,
    };
  }

  // Confidence-based sell (ETFs need 50%+ confidence, stocks 40%+)
  if (evaluation.confidence >= thresholds.sellConfidenceThreshold &&
      (evaluation.recommendation === 'sell' || evaluation.recommendation === 'strong_sell')) {
    return {
      shouldTrade: true,
      action: 'sell',
      quantity: position.quantity,
      reason: `${tag} Sell signal: ${evaluation.recommendation} with ${(evaluation.confidence * 100).toFixed(1)}% confidence (threshold: ${(thresholds.sellConfidenceThreshold * 100).toFixed(0)}%). P&L: ${pnlPct.toFixed(2)}%`,
    };
  }

  // Protective sell on bearish lean (ETFs: composite < -0.25, stocks: < -0.1)
  if (evaluation.compositeScore < thresholds.protectiveSellComposite && evaluation.confidence < thresholds.sellConfidenceThreshold) {
    return {
      shouldTrade: true,
      action: 'sell',
      quantity: position.quantity,
      reason: `${tag} Protective sell: bearish lean (score ${evaluation.compositeScore.toFixed(3)}, threshold ${thresholds.protectiveSellComposite}) with low confidence. Reducing risk.`,
    };
  }

  return {
    shouldTrade: false,
    action: 'sell',
    quantity: 0,
    reason: `${tag} Holding ${symbol}: P&L ${pnlPct.toFixed(2)}%, no sell trigger (stopLoss=${thresholds.stopLossPct}%, minHold=${thresholds.minHoldingDays}d)`,
  };
}

/**
 * Record a virtual trade in the database, update cash and positions.
 */
export function executeTrade(order: TradeOrder): number {
  const db = getDb();
  const totalValue = order.quantity * order.pricePerShare;

  // Use a transaction for atomicity
  const tradeId = db.transaction(() => {
    // 1) Insert trade record
    const result = db.prepare(`
      INSERT INTO trades (stock_id, action, quantity, price_per_share, total_value, confidence, rationale, signal_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      order.stockId, order.action, order.quantity,
      order.pricePerShare, totalValue, order.confidence,
      order.rationale, order.signalSnapshot
    );

    // 2) Update cash balance
    const cashChange = order.action === 'buy' ? -totalValue : totalValue;
    db.prepare(`
      UPDATE system_state
      SET value = CAST(CAST(value AS REAL) + ? AS TEXT), updated_at = datetime('now')
      WHERE key = 'cash_balance'
    `).run(cashChange);

    // 3) Update portfolio position
    if (order.action === 'buy') {
      // Upsert position
      const existing = db.prepare(
        'SELECT * FROM portfolio_positions WHERE stock_id = ?'
      ).get(order.stockId) as any;

      if (existing && existing.quantity > 0) {
        // Average up/down
        const newQty = existing.quantity + order.quantity;
        const newAvgCost = ((existing.average_cost * existing.quantity) + totalValue) / newQty;
        const marketVal = newQty * order.pricePerShare;
        const pnl = (order.pricePerShare - newAvgCost) * newQty;
        const pnlPct = newAvgCost > 0 ? ((order.pricePerShare - newAvgCost) / newAvgCost) * 100 : 0;

        db.prepare(`
          UPDATE portfolio_positions
          SET quantity = ?, average_cost = ?, current_price = ?,
              market_value = ?, unrealised_pnl = ?, unrealised_pnl_pct = ?,
              updated_at = datetime('now')
          WHERE stock_id = ?
        `).run(newQty, newAvgCost, order.pricePerShare, marketVal, pnl, pnlPct, order.stockId);
      } else if (existing) {
        // Re-open closed position
        db.prepare(`
          UPDATE portfolio_positions
          SET quantity = ?, average_cost = ?, current_price = ?,
              market_value = ?, unrealised_pnl = 0, unrealised_pnl_pct = 0,
              opened_at = datetime('now'), updated_at = datetime('now')
          WHERE stock_id = ?
        `).run(order.quantity, order.pricePerShare, order.pricePerShare, totalValue, order.stockId);
      } else {
        db.prepare(`
          INSERT INTO portfolio_positions (stock_id, quantity, average_cost, current_price, market_value)
          VALUES (?, ?, ?, ?, ?)
        `).run(order.stockId, order.quantity, order.pricePerShare, order.pricePerShare, totalValue);
      }
    } else {
      // Sell — reduce or close position
      const existing = db.prepare(
        'SELECT * FROM portfolio_positions WHERE stock_id = ?'
      ).get(order.stockId) as any;

      if (existing) {
        const newQty = Math.max(0, existing.quantity - order.quantity);
        if (newQty === 0) {
          db.prepare(`
            UPDATE portfolio_positions
            SET quantity = 0, market_value = 0, unrealised_pnl = 0,
                unrealised_pnl_pct = 0, updated_at = datetime('now')
            WHERE stock_id = ?
          `).run(order.stockId);
        } else {
          const marketVal = newQty * order.pricePerShare;
          const pnl = (order.pricePerShare - existing.average_cost) * newQty;
          const pnlPct = existing.average_cost > 0
            ? ((order.pricePerShare - existing.average_cost) / existing.average_cost) * 100 : 0;

          db.prepare(`
            UPDATE portfolio_positions
            SET quantity = ?, current_price = ?, market_value = ?,
                unrealised_pnl = ?, unrealised_pnl_pct = ?,
                updated_at = datetime('now')
            WHERE stock_id = ?
          `).run(newQty, order.pricePerShare, marketVal, pnl, pnlPct, order.stockId);
        }
      }
    }

    return Number(result.lastInsertRowid);
  })();

  console.log(
    `[TradingEngine] Executed ${order.action.toUpperCase()} ${order.quantity}x ${order.symbol} @ $${order.pricePerShare.toFixed(2)} (confidence: ${(order.confidence * 100).toFixed(1)}%)`
  );

  return tradeId;
}

/**
 * Calculate total portfolio value (cash + invested).
 */
export function getPortfolioValue(): number {
  const db = getDb();
  const cash = getCashBalance();
  const positions = db.prepare(
    'SELECT market_value FROM portfolio_positions WHERE quantity > 0'
  ).all() as any[];
  const invested = positions.reduce((s: number, p: any) => s + (p.market_value || 0), 0);
  return cash + invested;
}

/**
 * Get current cash balance.
 */
export function getCashBalance(): number {
  const db = getDb();
  const row = db.prepare(
    "SELECT value FROM system_state WHERE key = 'cash_balance'"
  ).get() as any;
  return parseFloat(row?.value ?? String(STARTING_CAPITAL));
}

/**
 * Record an analysis result in the database.
 */
export function recordAnalysis(
  stockId: number,
  evaluation: EvaluationResult
): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO analysis_logs
      (stock_id, composite_score, confidence_level, signal_breakdown, recommendation, rationale)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    stockId,
    evaluation.compositeScore,
    evaluation.confidence,
    JSON.stringify(evaluation.signalBreakdown),
    evaluation.recommendation,
    evaluation.rationale
  );
  return Number(result.lastInsertRowid);
}
