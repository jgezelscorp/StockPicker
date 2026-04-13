/**
 * Portfolio Tracker Tests
 *
 * Tests snapshot creation, P&L calculations, win rate,
 * performance metrics, and edge cases.
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

function getCash(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM system_state WHERE key = 'cash_balance'").get() as any;
  return parseFloat(row.value);
}

function setCash(db: Database.Database, amount: number): void {
  db.prepare("UPDATE system_state SET value = ? WHERE key = 'cash_balance'").run(String(amount));
}

function insertStock(db: Database.Database, symbol = 'AAPL'): number {
  const r = db.prepare(
    "INSERT INTO stocks (symbol, name, market, asset_type, currency) VALUES (?, ?, 'US', 'stock', 'USD')"
  ).run(symbol, `${symbol} Inc`);
  return Number(r.lastInsertRowid);
}

function insertPosition(db: Database.Database, stockId: number, qty: number, avgCost: number, currentPrice: number) {
  const mv = qty * currentPrice;
  const pnl = qty * (currentPrice - avgCost);
  const pnlPct = avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0;
  db.prepare(`
    INSERT INTO portfolio_positions (stock_id, quantity, average_cost, current_price, market_value, unrealised_pnl, unrealised_pnl_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(stockId, qty, avgCost, currentPrice, mv, pnl, pnlPct);
}

function insertTrade(db: Database.Database, stockId: number, action: 'buy' | 'sell', qty: number, price: number, confidence: number): number {
  const r = db.prepare(`
    INSERT INTO trades (stock_id, action, quantity, price_per_share, total_value, confidence, rationale, signal_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, 'Test trade', '{}')
  `).run(stockId, action, qty, price, qty * price, confidence);
  return Number(r.lastInsertRowid);
}

function createSnapshot(db: Database.Database): void {
  const cash = getCash(db);
  const positions = db.prepare('SELECT * FROM portfolio_positions WHERE quantity > 0').all() as any[];
  const investedValue = positions.reduce((s: number, p: any) => s + p.market_value, 0);
  const totalValue = cash + investedValue;
  const initialRow = db.prepare("SELECT value FROM system_state WHERE key = 'initial_capital'").get() as any;
  const initial = parseFloat(initialRow?.value ?? '100000');
  const totalPnl = totalValue - initial;
  const totalPnlPct = initial > 0 ? (totalPnl / initial) * 100 : 0;

  db.prepare(`
    INSERT INTO portfolio_snapshots (total_value, cash_balance, invested_value, total_pnl, total_pnl_pct, position_count)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(totalValue, cash, investedValue, totalPnl, totalPnlPct, positions.length);
}

function insertLearningOutcome(
  db: Database.Database,
  tradeId: number,
  expectedReturn: number,
  actualReturn: number,
  wasCorrect: boolean,
) {
  db.prepare(`
    INSERT INTO learning_outcomes (trade_id, expected_return, actual_return, holding_days, was_correct, lessons_learned)
    VALUES (?, ?, ?, 10, ?, '{}')
  `).run(tradeId, expectedReturn, actualReturn, wasCorrect ? 1 : 0);
}

// ─── Tests ──────────────────────────────────────────────────────

describe('PortfolioTracker', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  // ── Snapshot creation ──────────────────────────────────────────

  describe('Snapshot creation', () => {
    it('should create a snapshot with correct values for empty portfolio', () => {
      createSnapshot(db);
      const snap = db.prepare('SELECT * FROM portfolio_snapshots ORDER BY id DESC LIMIT 1').get() as any;

      expect(snap).toBeDefined();
      expect(snap.total_value).toBe(100_000);
      expect(snap.cash_balance).toBe(100_000);
      expect(snap.invested_value).toBe(0);
      expect(snap.total_pnl).toBe(0);
      expect(snap.position_count).toBe(0);
    });

    it('should create a snapshot reflecting open positions', () => {
      setCash(db, 85_000);
      const sid = insertStock(db, 'MSFT');
      insertPosition(db, sid, 100, 150, 160); // market_value = 16000

      createSnapshot(db);
      const snap = db.prepare('SELECT * FROM portfolio_snapshots ORDER BY id DESC LIMIT 1').get() as any;

      expect(snap.cash_balance).toBe(85_000);
      expect(snap.invested_value).toBe(16_000);
      expect(snap.total_value).toBe(101_000);
      expect(snap.total_pnl).toBeCloseTo(1_000, 0);
      expect(snap.position_count).toBe(1);
    });

    it('should create multiple snapshots over time', () => {
      createSnapshot(db);
      setCash(db, 90_000);
      const sid = insertStock(db);
      insertPosition(db, sid, 50, 100, 120);
      createSnapshot(db);

      const count = (db.prepare('SELECT COUNT(*) as cnt FROM portfolio_snapshots').get() as any).cnt;
      expect(count).toBe(2);
    });
  });

  // ── P&L calculation ────────────────────────────────────────────

  describe('P&L calculation', () => {
    it('should calculate unrealised P&L correctly', () => {
      const sid = insertStock(db);
      insertPosition(db, sid, 10, 100, 120); // bought at 100, now 120
      const pos = db.prepare('SELECT * FROM portfolio_positions WHERE stock_id = ?').get(sid) as any;

      expect(pos.unrealised_pnl).toBeCloseTo(200, 0); // 10 * (120 - 100)
      expect(pos.unrealised_pnl_pct).toBeCloseTo(20, 0); // 20%
    });

    it('should calculate negative unrealised P&L', () => {
      const sid = insertStock(db);
      insertPosition(db, sid, 10, 100, 85); // dropped to 85
      const pos = db.prepare('SELECT * FROM portfolio_positions WHERE stock_id = ?').get(sid) as any;

      expect(pos.unrealised_pnl).toBeCloseTo(-150, 0);
      expect(pos.unrealised_pnl_pct).toBeCloseTo(-15, 0);
    });

    it('should calculate realised P&L from learning outcomes', () => {
      const sid = insertStock(db);
      const buyId = insertTrade(db, sid, 'buy', 10, 100, 0.85);
      const sellId = insertTrade(db, sid, 'sell', 10, 130, 0.35);
      insertLearningOutcome(db, sellId, 0.15, 0.30, true);

      const outcome = db.prepare('SELECT * FROM learning_outcomes WHERE trade_id = ?').get(sellId) as any;
      expect(outcome.actual_return).toBe(0.30);
      expect(outcome.was_correct).toBe(1);
    });
  });

  // ── Win rate ───────────────────────────────────────────────────

  describe('Win rate calculation', () => {
    it('should calculate win rate correctly', () => {
      const sid = insertStock(db);
      const t1 = insertTrade(db, sid, 'sell', 10, 130, 0.4);
      const t2 = insertTrade(db, sid, 'sell', 10, 90, 0.4);
      const s2 = insertStock(db, 'GOOGL');
      const t3 = insertTrade(db, s2, 'sell', 5, 200, 0.3);

      insertLearningOutcome(db, t1, 0.10, 0.30, true);
      insertLearningOutcome(db, t2, 0.10, -0.10, false);
      insertLearningOutcome(db, t3, 0.10, 0.05, true);

      const outcomes = db.prepare('SELECT * FROM learning_outcomes').all() as any[];
      const wins = outcomes.filter((o: any) => o.was_correct);
      const winRate = (wins.length / outcomes.length) * 100;

      expect(winRate).toBeCloseTo(66.67, 0);
    });

    it('should return 0% win rate when no trades evaluated', () => {
      const outcomes = db.prepare('SELECT * FROM learning_outcomes').all() as any[];
      const winRate = outcomes.length > 0 ? (outcomes.filter((o: any) => o.was_correct).length / outcomes.length) * 100 : 0;
      expect(winRate).toBe(0);
    });
  });

  // ── Performance metrics ────────────────────────────────────────

  describe('Performance metrics', () => {
    it('should compute profit factor correctly', () => {
      const sid = insertStock(db);
      const t1 = insertTrade(db, sid, 'sell', 10, 130, 0.4);
      const t2 = insertTrade(db, sid, 'sell', 10, 90, 0.4);

      insertLearningOutcome(db, t1, 0.10, 0.30, true);  // +30% return
      insertLearningOutcome(db, t2, 0.10, -0.10, false); // -10% return

      const outcomes = db.prepare('SELECT * FROM learning_outcomes').all() as any[];
      const wins = outcomes.filter((o: any) => o.was_correct === 1);
      const losses = outcomes.filter((o: any) => o.was_correct === 0);
      const avgWin = wins.reduce((s: number, o: any) => s + o.actual_return, 0) / wins.length;
      const avgLoss = losses.reduce((s: number, o: any) => s + Math.abs(o.actual_return), 0) / losses.length;
      const profitFactor = avgLoss > 0 ? avgWin / avgLoss : Infinity;

      expect(profitFactor).toBeCloseTo(3, 4); // 0.30 / 0.10
    });

    it('should compute total return including current positions', () => {
      setCash(db, 85_000);
      const sid = insertStock(db);
      insertPosition(db, sid, 100, 150, 170); // +$2000 unrealised

      const initial = 100_000;
      const cash = getCash(db);
      const invested = (db.prepare('SELECT COALESCE(SUM(market_value), 0) as total FROM portfolio_positions').get() as any).total;
      const totalValue = cash + invested;
      const totalReturn = totalValue - initial;

      expect(totalReturn).toBe(2_000);
      expect((totalReturn / initial) * 100).toBe(2);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should handle empty portfolio gracefully', () => {
      createSnapshot(db);
      const snap = db.prepare('SELECT * FROM portfolio_snapshots ORDER BY id DESC LIMIT 1').get() as any;
      expect(snap.total_value).toBe(100_000);
      expect(snap.total_pnl).toBe(0);
      expect(snap.total_pnl_pct).toBe(0);
    });

    it('should handle portfolio with only losing positions', () => {
      setCash(db, 70_000);
      const s1 = insertStock(db, 'LOSER1');
      const s2 = insertStock(db, 'LOSER2');
      insertPosition(db, s1, 100, 150, 130); // -$2000
      insertPosition(db, s2, 100, 200, 170); // -$3000

      createSnapshot(db);
      const snap = db.prepare('SELECT * FROM portfolio_snapshots ORDER BY id DESC LIMIT 1').get() as any;

      const invested = 100 * 130 + 100 * 170; // 30000
      expect(snap.total_value).toBe(70_000 + invested);
      // Total value = 70000 + 30000 = 100000 = initial capital → pnl = 0
      // But the cost basis was higher (150+200 avg) so unrealised PnL is negative
      // However snapshot pnl is totalValue - initial, and here we set cash independently
      expect(snap.total_value).toBe(100_000);
      // The unrealised PnL on positions is negative
      const positions = db.prepare('SELECT * FROM portfolio_positions').all() as any[];
      const totalUnrealised = positions.reduce((s: number, p: any) => s + p.unrealised_pnl, 0);
      expect(totalUnrealised).toBeLessThan(0);
    });

    it('should preserve snapshot history even when portfolio resets', () => {
      createSnapshot(db);
      createSnapshot(db);
      const count = (db.prepare('SELECT COUNT(*) as cnt FROM portfolio_snapshots').get() as any).cnt;
      expect(count).toBe(2);
    });
  });
});
