import { getDb } from '../db';
import { getCashBalance, getPortfolioValue } from './tradingEngine';

// ─── Types ──────────────────────────────────────────────────────

export interface PortfolioPosition {
  id: number;
  stockId: number;
  symbol: string;
  name: string;
  market: string;
  sector: string | null;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealisedPnl: number;
  unrealisedPnlPct: number;
  openedAt: string;
  updatedAt: string;
}

export interface PortfolioSummary {
  totalValue: number;
  cashBalance: number;
  investedValue: number;
  totalPnl: number;
  totalPnlPct: number;
  positionCount: number;
  positions: PortfolioPosition[];
}

export interface TradeRecord {
  id: number;
  stockId: number;
  symbol: string;
  stockName: string;
  action: string;
  quantity: number;
  pricePerShare: number;
  totalValue: number;
  confidence: number;
  rationale: string;
  signalSnapshot: string;
  executedAt: string;
}

export interface TradeFilters {
  symbol?: string;
  action?: 'buy' | 'sell';
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeEstimate: number;
  totalTrades: number;
  openPositions: number;
  closedPositions: number;
  bestTrade: { symbol: string; returnPct: number } | null;
  worstTrade: { symbol: string; returnPct: number } | null;
  avgHoldingDays: number;
}

// ─── Portfolio ──────────────────────────────────────────────────

/**
 * Get current portfolio with all positions and P&L.
 */
export function getPortfolio(): PortfolioSummary {
  const db = getDb();
  const cashBalance = getCashBalance();

  const positions = db.prepare(`
    SELECT pp.*, s.symbol, s.name, s.market, s.sector
    FROM portfolio_positions pp
    JOIN stocks s ON s.id = pp.stock_id
    WHERE pp.quantity > 0
    ORDER BY pp.market_value DESC
  `).all() as any[];

  const mapped: PortfolioPosition[] = positions.map((p: any) => ({
    id: p.id,
    stockId: p.stock_id,
    symbol: p.symbol,
    name: p.name,
    market: p.market,
    sector: p.sector,
    quantity: p.quantity,
    averageCost: p.average_cost,
    currentPrice: p.current_price,
    marketValue: p.market_value,
    unrealisedPnl: p.unrealised_pnl,
    unrealisedPnlPct: p.unrealised_pnl_pct,
    openedAt: p.opened_at,
    updatedAt: p.updated_at,
  }));

  const investedValue = mapped.reduce((s, p) => s + p.marketValue, 0);
  const totalValue = cashBalance + investedValue;

  const initialRow = db.prepare(
    "SELECT value FROM system_state WHERE key = 'initial_capital'"
  ).get() as any;
  const initial = parseFloat(initialRow?.value ?? '100000');
  const totalPnl = totalValue - initial;
  const totalPnlPct = initial > 0 ? (totalPnl / initial) * 100 : 0;

  return {
    totalValue,
    cashBalance,
    investedValue,
    totalPnl,
    totalPnlPct,
    positionCount: mapped.length,
    positions: mapped,
  };
}

/**
 * Get portfolio value history for charting.
 */
export function getPortfolioHistory(days: number = 90): any[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM portfolio_snapshots
    WHERE snapshot_at >= datetime('now', '-' || ? || ' days')
    ORDER BY snapshot_at ASC
  `).all(days);
}

/**
 * Get trade history with optional filters.
 */
export function getTradeHistory(filters: TradeFilters = {}): {
  trades: TradeRecord[];
  total: number;
  page: number;
  pageSize: number;
} {
  const db = getDb();
  const page = filters.page || 1;
  const pageSize = Math.min(filters.pageSize || 20, 100);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: any[] = [];

  if (filters.symbol) {
    conditions.push('s.symbol = ?');
    params.push(filters.symbol.toUpperCase());
  }
  if (filters.action) {
    conditions.push('t.action = ?');
    params.push(filters.action);
  }
  if (filters.fromDate) {
    conditions.push('t.executed_at >= ?');
    params.push(filters.fromDate);
  }
  if (filters.toDate) {
    conditions.push('t.executed_at <= ?');
    params.push(filters.toDate);
  }

  const whereClause = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : '';

  const totalRow = db.prepare(
    `SELECT COUNT(*) as cnt FROM trades t JOIN stocks s ON s.id = t.stock_id ${whereClause}`
  ).get(...params) as any;

  const rows = db.prepare(`
    SELECT t.*, s.symbol, s.name as stock_name
    FROM trades t
    JOIN stocks s ON s.id = t.stock_id
    ${whereClause}
    ORDER BY t.executed_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset) as any[];

  const trades: TradeRecord[] = rows.map((r: any) => ({
    id: r.id,
    stockId: r.stock_id,
    symbol: r.symbol,
    stockName: r.stock_name,
    action: r.action,
    quantity: r.quantity,
    pricePerShare: r.price_per_share,
    totalValue: r.total_value,
    confidence: r.confidence,
    rationale: r.rationale,
    signalSnapshot: r.signal_snapshot,
    executedAt: r.executed_at,
  }));

  return { trades, total: totalRow.cnt, page, pageSize };
}

/**
 * Take a daily snapshot of portfolio state.
 */
export function takeSnapshot(): void {
  const db = getDb();
  const cashBalance = getCashBalance();
  const positions = db.prepare(
    'SELECT market_value FROM portfolio_positions WHERE quantity > 0'
  ).all() as any[];
  const investedValue = positions.reduce((s: number, p: any) => s + (p.market_value || 0), 0);
  const totalValue = cashBalance + investedValue;

  const initialRow = db.prepare(
    "SELECT value FROM system_state WHERE key = 'initial_capital'"
  ).get() as any;
  const initial = parseFloat(initialRow?.value ?? '100000');
  const totalPnl = totalValue - initial;
  const totalPnlPct = initial > 0 ? (totalPnl / initial) * 100 : 0;

  db.prepare(`
    INSERT INTO portfolio_snapshots
      (total_value, cash_balance, invested_value, total_pnl, total_pnl_pct, position_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(totalValue, cashBalance, investedValue, totalPnl, totalPnlPct, positions.length);

  console.log(
    `[PortfolioTracker] Snapshot: $${totalValue.toFixed(2)} | Cash: $${cashBalance.toFixed(2)} | Invested: $${investedValue.toFixed(2)} | P&L: ${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%`
  );
}

/**
 * Calculate performance metrics including Sharpe-like ratio, win rate, etc.
 */
export function getPerformanceMetrics(): PerformanceMetrics {
  const db = getDb();

  // Portfolio value
  const totalValue = getPortfolioValue();
  const initialRow = db.prepare(
    "SELECT value FROM system_state WHERE key = 'initial_capital'"
  ).get() as any;
  const initial = parseFloat(initialRow?.value ?? '100000');
  const totalReturn = totalValue - initial;
  const totalReturnPct = initial > 0 ? (totalReturn / initial) * 100 : 0;

  // Trade counts
  const totalTrades = (db.prepare('SELECT COUNT(*) as cnt FROM trades').get() as any).cnt;
  const openPositions = (db.prepare(
    'SELECT COUNT(*) as cnt FROM portfolio_positions WHERE quantity > 0'
  ).get() as any).cnt;

  // Learning outcomes for win/loss analysis
  const outcomes = db.prepare('SELECT * FROM learning_outcomes').all() as any[];
  const wins = outcomes.filter((o: any) => o.was_correct);
  const losses = outcomes.filter((o: any) => !o.was_correct);
  const winRate = outcomes.length > 0 ? (wins.length / outcomes.length) * 100 : 0;
  const avgWin = wins.length > 0
    ? wins.reduce((s: number, o: any) => s + o.actual_return, 0) / wins.length : 0;
  const avgLoss = losses.length > 0
    ? losses.reduce((s: number, o: any) => s + Math.abs(o.actual_return), 0) / losses.length : 0;
  const profitFactor = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0);

  // Best/worst trades
  let bestTrade: PerformanceMetrics['bestTrade'] = null;
  let worstTrade: PerformanceMetrics['worstTrade'] = null;
  if (outcomes.length > 0) {
    const best = outcomes.reduce((a: any, b: any) => a.actual_return > b.actual_return ? a : b);
    const worst = outcomes.reduce((a: any, b: any) => a.actual_return < b.actual_return ? a : b);

    const bestTradeRow = db.prepare(`
      SELECT s.symbol FROM trades t JOIN stocks s ON s.id = t.stock_id WHERE t.id = ?
    `).get(best.trade_id) as any;
    const worstTradeRow = db.prepare(`
      SELECT s.symbol FROM trades t JOIN stocks s ON s.id = t.stock_id WHERE t.id = ?
    `).get(worst.trade_id) as any;

    if (bestTradeRow) bestTrade = { symbol: bestTradeRow.symbol, returnPct: best.actual_return };
    if (worstTradeRow) worstTrade = { symbol: worstTradeRow.symbol, returnPct: worst.actual_return };
  }

  // Average holding days
  const avgHoldingDays = outcomes.length > 0
    ? outcomes.reduce((s: number, o: any) => s + o.holding_days, 0) / outcomes.length
    : 0;

  // Sharpe-like ratio from daily snapshots
  let sharpeEstimate = 0;
  const snapshots = db.prepare(`
    SELECT total_value FROM portfolio_snapshots ORDER BY snapshot_at ASC
  `).all() as any[];

  if (snapshots.length >= 2) {
    const dailyReturns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1].total_value;
      if (prev > 0) {
        dailyReturns.push((snapshots[i].total_value - prev) / prev);
      }
    }
    if (dailyReturns.length > 1) {
      const meanReturn = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
      const variance = dailyReturns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / dailyReturns.length;
      const stddev = Math.sqrt(variance);
      // Annualise: multiply mean by 252, stddev by sqrt(252)
      if (stddev > 0) {
        sharpeEstimate = (meanReturn * 252) / (stddev * Math.sqrt(252));
      }
    }
  }

  return {
    totalReturn,
    totalReturnPct,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    sharpeEstimate: Number(sharpeEstimate.toFixed(3)),
    totalTrades,
    openPositions,
    closedPositions: outcomes.length,
    bestTrade,
    worstTrade,
    avgHoldingDays: Number(avgHoldingDays.toFixed(1)),
  };
}

/**
 * Analyze decision quality — how well are our buy/sell decisions?
 */
export function getDecisionQualityAnalysis(): any {
  const db = getDb();

  // Compare buy confidence vs actual outcome
  const outcomes = db.prepare(`
    SELECT lo.*, t.confidence as trade_confidence, t.action,
           t.price_per_share, s.symbol
    FROM learning_outcomes lo
    JOIN trades t ON t.id = lo.trade_id
    JOIN stocks s ON s.id = t.stock_id
    ORDER BY lo.evaluated_at DESC
  `).all() as any[];

  // Bucket by confidence range
  const buckets: Record<string, { total: number; wins: number; avgReturn: number }> = {
    'low (40-60%)': { total: 0, wins: 0, avgReturn: 0 },
    'medium (60-80%)': { total: 0, wins: 0, avgReturn: 0 },
    'high (80-100%)': { total: 0, wins: 0, avgReturn: 0 },
  };

  for (const o of outcomes) {
    const conf = o.trade_confidence * 100;
    let bucket: string;
    if (conf < 60) bucket = 'low (40-60%)';
    else if (conf < 80) bucket = 'medium (60-80%)';
    else bucket = 'high (80-100%)';

    buckets[bucket].total++;
    if (o.was_correct) buckets[bucket].wins++;
    buckets[bucket].avgReturn += o.actual_return;
  }

  for (const key of Object.keys(buckets)) {
    if (buckets[key].total > 0) {
      buckets[key].avgReturn /= buckets[key].total;
    }
  }

  // Signal source accuracy
  const recentAnalyses = db.prepare(`
    SELECT signal_breakdown FROM analysis_logs ORDER BY analysed_at DESC LIMIT 100
  `).all() as any[];

  return {
    totalEvaluated: outcomes.length,
    confidenceBuckets: buckets,
    recentAnalysisCount: recentAnalyses.length,
    outcomes: outcomes.slice(0, 20),
  };
}
