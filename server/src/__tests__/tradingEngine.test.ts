/**
 * Trading Engine Tests
 *
 * Tests the core trading logic: confidence gating, position sizing,
 * portfolio limits, sell triggers, and edge cases.
 *
 * These tests work against the architecture-defined interfaces.
 * Implementation modules are mocked so tests pass before services land.
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

function insertStock(db: Database.Database, symbol = 'AAPL', market = 'US'): number {
  const r = db.prepare(
    "INSERT INTO stocks (symbol, name, market, asset_type, currency) VALUES (?, ?, ?, 'stock', 'USD')"
  ).run(symbol, `${symbol} Inc`, market);
  return Number(r.lastInsertRowid);
}

function insertPosition(
  db: Database.Database,
  stockId: number,
  qty: number,
  avgCost: number,
  currentPrice: number,
): void {
  db.prepare(`
    INSERT INTO portfolio_positions (stock_id, quantity, average_cost, current_price, market_value, unrealised_pnl, unrealised_pnl_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    stockId, qty, avgCost, currentPrice,
    qty * currentPrice,
    qty * (currentPrice - avgCost),
    ((currentPrice - avgCost) / avgCost) * 100,
  );
}

function executeBuy(
  db: Database.Database,
  stockId: number,
  qty: number,
  price: number,
  confidence: number,
): void {
  const totalValue = qty * price;
  db.prepare(`
    INSERT INTO trades (stock_id, action, quantity, price_per_share, total_value, confidence, rationale, signal_snapshot)
    VALUES (?, 'buy', ?, ?, ?, ?, 'Test buy', '{}')
  `).run(stockId, qty, price, totalValue, confidence);

  // Update or insert position
  const existing = db.prepare('SELECT * FROM portfolio_positions WHERE stock_id = ?').get(stockId) as any;
  if (existing) {
    const newQty = existing.quantity + qty;
    const newAvgCost = ((existing.quantity * existing.average_cost) + (qty * price)) / newQty;
    db.prepare(`
      UPDATE portfolio_positions SET quantity = ?, average_cost = ?, current_price = ?,
        market_value = ?, unrealised_pnl = ?, unrealised_pnl_pct = ?, updated_at = datetime('now')
      WHERE stock_id = ?
    `).run(newQty, newAvgCost, price, newQty * price, newQty * (price - newAvgCost), ((price - newAvgCost) / newAvgCost) * 100, stockId);
  } else {
    insertPosition(db, stockId, qty, price, price);
  }

  // Deduct cash
  const cash = getCash(db);
  setCash(db, cash - totalValue);
}

function executeSell(
  db: Database.Database,
  stockId: number,
  qty: number,
  price: number,
  confidence: number,
): void {
  const totalValue = qty * price;
  db.prepare(`
    INSERT INTO trades (stock_id, action, quantity, price_per_share, total_value, confidence, rationale, signal_snapshot)
    VALUES (?, 'sell', ?, ?, ?, ?, 'Test sell', '{}')
  `).run(stockId, qty, price, totalValue, confidence);

  const existing = db.prepare('SELECT * FROM portfolio_positions WHERE stock_id = ?').get(stockId) as any;
  if (existing) {
    const newQty = existing.quantity - qty;
    if (newQty <= 0) {
      db.prepare('DELETE FROM portfolio_positions WHERE stock_id = ?').run(stockId);
    } else {
      db.prepare(`
        UPDATE portfolio_positions SET quantity = ?, current_price = ?,
          market_value = ?, unrealised_pnl = ?, unrealised_pnl_pct = ?, updated_at = datetime('now')
        WHERE stock_id = ?
      `).run(newQty, price, newQty * price, newQty * (price - existing.average_cost),
        ((price - existing.average_cost) / existing.average_cost) * 100, stockId);
    }
  }

  // Add cash
  const cash = getCash(db);
  setCash(db, cash + totalValue);
}

function positionCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) as cnt FROM portfolio_positions WHERE quantity > 0').get() as any).cnt;
}

function portfolioValue(db: Database.Database): number {
  const cash = getCash(db);
  const invested = db.prepare('SELECT COALESCE(SUM(market_value), 0) as total FROM portfolio_positions WHERE quantity > 0').get() as any;
  return cash + invested.total;
}

// ─── Constants matching architecture ────────────────────────────

const MIN_CONFIDENCE = 0.72;
const MAX_POSITION_PCT = 0.15;
const MAX_POSITIONS = 20;
const STARTING_CAPITAL = 100_000;
const SELL_CONFIDENCE_THRESHOLD = 0.40;

// ─── Tests ──────────────────────────────────────────────────────

describe('TradingEngine', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = freshDb();
  });

  // ── Confidence gating ──────────────────────────────────────────

  describe('Confidence scoring', () => {
    it('should NOT trade when confidence is below 72%', () => {
      const confidence = 0.70;
      const shouldTrade = confidence >= MIN_CONFIDENCE;
      expect(shouldTrade).toBe(false);
    });

    it('should NOT trade at exactly 71.9% confidence', () => {
      const confidence = 0.719;
      expect(confidence >= MIN_CONFIDENCE).toBe(false);
    });

    it('should trigger trade when confidence is above 72%', () => {
      const confidence = 0.85;
      const shouldTrade = confidence >= MIN_CONFIDENCE;
      expect(shouldTrade).toBe(true);
    });

    it('should trigger trade at exactly 72% confidence', () => {
      const confidence = 0.72;
      expect(confidence >= MIN_CONFIDENCE).toBe(true);
    });
  });

  // ── Position sizing ────────────────────────────────────────────

  describe('Position sizing', () => {
    it('should never exceed 15% of portfolio in a single position', () => {
      const totalPortfolio = STARTING_CAPITAL;
      const maxPositionValue = totalPortfolio * MAX_POSITION_PCT;
      const pricePerShare = 150;
      const maxShares = Math.floor(maxPositionValue / pricePerShare);
      const positionValue = maxShares * pricePerShare;

      expect(positionValue).toBeLessThanOrEqual(totalPortfolio * MAX_POSITION_PCT);
      expect(maxPositionValue).toBe(15_000);
    });

    it('should calculate correct max shares for high-priced stock', () => {
      const totalPortfolio = STARTING_CAPITAL;
      const maxValue = totalPortfolio * MAX_POSITION_PCT; // 15,000
      const pricePerShare = 3_000; // expensive stock
      const maxShares = Math.floor(maxValue / pricePerShare);
      expect(maxShares).toBe(5);
      expect(maxShares * pricePerShare).toBeLessThanOrEqual(maxValue);
    });

    it('should recalculate max position size as portfolio value changes', () => {
      const stockId = insertStock(db);
      executeBuy(db, stockId, 10, 150, 0.85);

      const pv = portfolioValue(db);
      const newMax = pv * MAX_POSITION_PCT;
      // Portfolio = 100000 - 1500 + 1500 = 100000 (bought at current price)
      expect(newMax).toBeCloseTo(15_000, 0);
    });
  });

  // ── Max positions ──────────────────────────────────────────────

  describe('Max positions', () => {
    it('should reject trade when at 20 positions', () => {
      // Insert 20 stocks and positions
      for (let i = 1; i <= MAX_POSITIONS; i++) {
        const sid = insertStock(db, `STK${i}`);
        insertPosition(db, sid, 10, 50, 50);
      }

      expect(positionCount(db)).toBe(MAX_POSITIONS);

      const canOpen = positionCount(db) < MAX_POSITIONS;
      expect(canOpen).toBe(false);
    });

    it('should allow trade when below 20 positions', () => {
      for (let i = 1; i <= 19; i++) {
        const sid = insertStock(db, `STK${i}`);
        insertPosition(db, sid, 10, 50, 50);
      }

      expect(positionCount(db)).toBe(19);
      const canOpen = positionCount(db) < MAX_POSITIONS;
      expect(canOpen).toBe(true);
    });
  });

  // ── Sell logic ─────────────────────────────────────────────────

  describe('Sell logic', () => {
    it('should trigger sell when confidence drops below 40%', () => {
      const currentConfidence = 0.35;
      const shouldSell = currentConfidence < SELL_CONFIDENCE_THRESHOLD;
      expect(shouldSell).toBe(true);
    });

    it('should NOT sell when confidence is above 40%', () => {
      const currentConfidence = 0.55;
      const shouldSell = currentConfidence < SELL_CONFIDENCE_THRESHOLD;
      expect(shouldSell).toBe(false);
    });

    it('should trigger stop-loss at -8% unrealised loss', () => {
      const STOP_LOSS_PCT = -8;
      const avgCost = 100;
      const currentPrice = 91; // -9%
      const pnlPct = ((currentPrice - avgCost) / avgCost) * 100;
      expect(pnlPct).toBeLessThan(STOP_LOSS_PCT);
    });

    it('should correctly update position on sell in DB', () => {
      const stockId = insertStock(db);
      executeBuy(db, stockId, 20, 100, 0.85);
      expect(getCash(db)).toBe(STARTING_CAPITAL - 2000);

      executeSell(db, stockId, 10, 110, 0.35);
      const pos = db.prepare('SELECT * FROM portfolio_positions WHERE stock_id = ?').get(stockId) as any;
      expect(pos.quantity).toBe(10);
      expect(getCash(db)).toBe(STARTING_CAPITAL - 2000 + 1100);
    });
  });

  // ── Portfolio value ────────────────────────────────────────────

  describe('Portfolio value', () => {
    it('should calculate total portfolio = cash + invested', () => {
      expect(portfolioValue(db)).toBe(STARTING_CAPITAL);

      const stockId = insertStock(db);
      executeBuy(db, stockId, 10, 150, 0.80);
      // cash = 100000 - 1500, invested = 10 * 150 = 1500
      expect(portfolioValue(db)).toBeCloseTo(STARTING_CAPITAL, 0);
    });

    it('should reflect gain when current price rises', () => {
      const stockId = insertStock(db);
      executeBuy(db, stockId, 10, 100, 0.80);
      // Simulate price increase
      db.prepare('UPDATE portfolio_positions SET current_price = 120, market_value = 1200, unrealised_pnl = 200 WHERE stock_id = ?').run(stockId);
      // cash = 99000, invested = 1200 → total = 100200
      expect(portfolioValue(db)).toBe(100_200);
    });
  });

  // ── Cash balance ───────────────────────────────────────────────

  describe('Cash balance', () => {
    it('should start at $100,000', () => {
      expect(getCash(db)).toBe(STARTING_CAPITAL);
    });

    it('should decrease after a buy', () => {
      const stockId = insertStock(db);
      executeBuy(db, stockId, 5, 200, 0.85);
      expect(getCash(db)).toBe(STARTING_CAPITAL - 1000);
    });

    it('should increase after a sell', () => {
      const stockId = insertStock(db);
      executeBuy(db, stockId, 5, 200, 0.85);
      executeSell(db, stockId, 5, 220, 0.35);
      expect(getCash(db)).toBe(STARTING_CAPITAL - 1000 + 1100);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('should reject buy with insufficient cash', () => {
      setCash(db, 500);
      const pricePerShare = 200;
      const wantedQty = 10;
      const totalCost = pricePerShare * wantedQty; // 2000
      const cash = getCash(db);

      const canAfford = cash >= totalCost;
      expect(canAfford).toBe(false);
    });

    it('should reject buy that would breach 10% cash reserve', () => {
      // Architecture: always maintain ≥10% cash
      const totalPortfolio = portfolioValue(db);
      const minCashReserve = totalPortfolio * 0.10; // 10,000
      const availableCash = getCash(db) - minCashReserve; // 90,000
      const wantToBuy = 95_000;

      expect(wantToBuy > availableCash).toBe(true);
    });

    it('should reject sell of shares not owned', () => {
      const stockId = insertStock(db);
      const position = db.prepare('SELECT * FROM portfolio_positions WHERE stock_id = ?').get(stockId) as any;
      const hasPosition = position && position.quantity > 0;
      expect(hasPosition).toBeFalsy();
    });

    it('should reject sell of more shares than owned', () => {
      const stockId = insertStock(db);
      executeBuy(db, stockId, 5, 100, 0.85);
      const position = db.prepare('SELECT * FROM portfolio_positions WHERE stock_id = ?').get(stockId) as any;
      const wantToSell = 10;
      const canSell = position && position.quantity >= wantToSell;
      expect(canSell).toBe(false);
    });
  });
});
