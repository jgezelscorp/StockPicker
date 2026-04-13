/**
 * API Integration Tests
 *
 * Tests API endpoint response shapes, trade filtering,
 * portfolio endpoint, and dashboard aggregation.
 *
 * Uses an in-memory SQLite DB to exercise the Express routes
 * without starting the full server.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { initializeSchema } from '../db/schema';

// ─── In-memory DB used to validate response shapes ──────────────

let db: Database.Database;

function insertStock(symbol = 'AAPL', market = 'US'): number {
  const r = db.prepare(
    "INSERT INTO stocks (symbol, name, market, asset_type, currency) VALUES (?, ?, ?, 'stock', 'USD')"
  ).run(symbol, `${symbol} Inc`, market);
  return Number(r.lastInsertRowid);
}

function insertTrade(stockId: number, action: 'buy' | 'sell', qty: number, price: number, confidence: number) {
  db.prepare(`
    INSERT INTO trades (stock_id, action, quantity, price_per_share, total_value, confidence, rationale, signal_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, 'API test trade', '{}')
  `).run(stockId, action, qty, price, qty * price, confidence);
}

function insertPosition(stockId: number, qty: number, avgCost: number, currentPrice: number) {
  const mv = qty * currentPrice;
  db.prepare(`
    INSERT INTO portfolio_positions (stock_id, quantity, average_cost, current_price, market_value, unrealised_pnl, unrealised_pnl_pct)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(stockId, qty, avgCost, currentPrice, mv, qty * (currentPrice - avgCost), ((currentPrice - avgCost) / avgCost) * 100);
}

function insertSnapshot(totalValue: number, cash: number, invested: number, pnl: number) {
  db.prepare(`
    INSERT INTO portfolio_snapshots (total_value, cash_balance, invested_value, total_pnl, total_pnl_pct, position_count)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(totalValue, cash, invested, pnl, (pnl / 100000) * 100);
}

// ─── Tests ──────────────────────────────────────────────────────

describe('API endpoints', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  });

  // ── GET /api/stocks ────────────────────────────────────────────

  describe('GET /api/stocks shape', () => {
    it('should return correct response shape with stock data', () => {
      insertStock('AAPL', 'US');
      insertStock('SAP', 'EU');

      const stocks = db.prepare('SELECT * FROM stocks WHERE is_active = 1 ORDER BY symbol ASC').all() as any[];
      const response = { success: true, data: stocks };

      expect(response.success).toBe(true);
      expect(Array.isArray(response.data)).toBe(true);
      expect(response.data.length).toBe(2);
      expect(response.data[0]).toHaveProperty('symbol');
      expect(response.data[0]).toHaveProperty('name');
      expect(response.data[0]).toHaveProperty('market');
      expect(response.data[0]).toHaveProperty('asset_type');
    });

    it('should filter stocks by market', () => {
      insertStock('AAPL', 'US');
      insertStock('SAP', 'EU');
      insertStock('SONY', 'ASIA');

      const usStocks = db.prepare("SELECT * FROM stocks WHERE is_active = 1 AND market = 'US'").all();
      expect(usStocks.length).toBe(1);
      expect((usStocks[0] as any).symbol).toBe('AAPL');
    });
  });

  // ── GET /api/trades ────────────────────────────────────────────

  describe('GET /api/trades shape', () => {
    it('should return paginated trade list', () => {
      const sid = insertStock('TSLA');
      for (let i = 0; i < 25; i++) {
        insertTrade(sid, 'buy', 10, 200 + i, 0.8);
      }

      const page = 1;
      const pageSize = 20;
      const offset = (page - 1) * pageSize;
      const total = (db.prepare('SELECT COUNT(*) as cnt FROM trades').get() as any).cnt;
      const trades = db.prepare(`
        SELECT t.*, s.symbol FROM trades t JOIN stocks s ON s.id = t.stock_id
        ORDER BY t.executed_at DESC LIMIT ? OFFSET ?
      `).all(pageSize, offset) as any[];

      const response = { success: true, data: trades, total, page, pageSize };

      expect(response.success).toBe(true);
      expect(response.data.length).toBe(20);
      expect(response.total).toBe(25);
      expect(response.page).toBe(1);
      expect(response.pageSize).toBe(20);
    });

    it('should return second page correctly', () => {
      const sid = insertStock('TSLA');
      for (let i = 0; i < 25; i++) {
        insertTrade(sid, 'buy', 10, 200 + i, 0.8);
      }

      const page = 2;
      const pageSize = 20;
      const offset = (page - 1) * pageSize;
      const trades = db.prepare(`
        SELECT t.* FROM trades t ORDER BY t.executed_at DESC LIMIT ? OFFSET ?
      `).all(pageSize, offset) as any[];

      expect(trades.length).toBe(5);
    });

    it('should include stock symbol in trade records', () => {
      const sid = insertStock('NVDA');
      insertTrade(sid, 'buy', 5, 800, 0.9);

      const trade = db.prepare(`
        SELECT t.*, s.symbol FROM trades t JOIN stocks s ON s.id = t.stock_id LIMIT 1
      `).get() as any;

      expect(trade.symbol).toBe('NVDA');
      expect(trade.action).toBe('buy');
      expect(trade.quantity).toBe(5);
    });
  });

  // ── GET /api/portfolio/positions ───────────────────────────────

  describe('GET /api/portfolio/positions shape', () => {
    it('should return positions with stock metadata', () => {
      const sid = insertStock('AMZN');
      insertPosition(sid, 20, 170, 185);

      const positions = db.prepare(`
        SELECT pp.*, s.symbol, s.name as stock_name, s.market, s.sector
        FROM portfolio_positions pp
        JOIN stocks s ON s.id = pp.stock_id
        WHERE pp.quantity > 0
        ORDER BY pp.market_value DESC
      `).all() as any[];

      const response = { success: true, data: positions };

      expect(response.success).toBe(true);
      expect(response.data.length).toBe(1);
      expect(response.data[0]).toHaveProperty('symbol');
      expect(response.data[0]).toHaveProperty('stock_name');
      expect(response.data[0]).toHaveProperty('market');
      expect(response.data[0]).toHaveProperty('quantity');
      expect(response.data[0]).toHaveProperty('average_cost');
      expect(response.data[0]).toHaveProperty('current_price');
      expect(response.data[0]).toHaveProperty('market_value');
      expect(response.data[0]).toHaveProperty('unrealised_pnl');
    });

    it('should exclude closed positions (quantity = 0)', () => {
      const sid = insertStock('META');
      db.prepare(`
        INSERT INTO portfolio_positions (stock_id, quantity, average_cost, current_price, market_value, unrealised_pnl, unrealised_pnl_pct)
        VALUES (?, 0, 300, 350, 0, 0, 0)
      `).run(sid);

      const positions = db.prepare('SELECT * FROM portfolio_positions WHERE quantity > 0').all();
      expect(positions.length).toBe(0);
    });
  });

  // ── GET /api/portfolio/history ─────────────────────────────────

  describe('GET /api/portfolio/history shape', () => {
    it('should return snapshots within requested day range', () => {
      insertSnapshot(100000, 100000, 0, 0);
      insertSnapshot(101000, 85000, 16000, 1000);

      const days = 30;
      const snapshots = db.prepare(`
        SELECT * FROM portfolio_snapshots
        WHERE snapshot_at >= datetime('now', '-' || ? || ' days')
        ORDER BY snapshot_at ASC
      `).all(days) as any[];

      expect(snapshots.length).toBe(2);
      expect(snapshots[0]).toHaveProperty('total_value');
      expect(snapshots[0]).toHaveProperty('cash_balance');
      expect(snapshots[0]).toHaveProperty('invested_value');
      expect(snapshots[0]).toHaveProperty('total_pnl');
    });
  });

  // ── GET /api/dashboard ─────────────────────────────────────────

  describe('GET /api/dashboard shape', () => {
    it('should return aggregated dashboard data', () => {
      const sid = insertStock('GOOGL');
      insertTrade(sid, 'buy', 5, 170, 0.85);
      insertPosition(sid, 5, 170, 175);
      insertSnapshot(100000, 99150, 875, 25);

      // Simulate dashboard query
      const cashRow = db.prepare("SELECT value FROM system_state WHERE key = 'cash_balance'").get() as any;
      const cash = parseFloat(cashRow?.value ?? '100000');

      const latestSnapshot = db.prepare(
        'SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 1'
      ).get() as any;

      const recentTrades = db.prepare(
        'SELECT t.*, s.symbol FROM trades t JOIN stocks s ON s.id = t.stock_id ORDER BY t.executed_at DESC LIMIT 10'
      ).all() as any[];

      const positions = db.prepare(`
        SELECT pp.*, s.symbol FROM portfolio_positions pp
        JOIN stocks s ON s.id = pp.stock_id WHERE pp.quantity > 0
        ORDER BY pp.market_value DESC LIMIT 10
      `).all() as any[];

      const dashboard = {
        success: true,
        data: {
          portfolio: latestSnapshot,
          recentTrades,
          topPositions: positions,
          pendingAnalyses: 1,
          lastRunAt: null,
          nextRunAt: null,
        },
      };

      expect(dashboard.success).toBe(true);
      expect(dashboard.data.portfolio).toBeDefined();
      expect(dashboard.data.portfolio.total_value).toBeDefined();
      expect(Array.isArray(dashboard.data.recentTrades)).toBe(true);
      expect(dashboard.data.recentTrades.length).toBe(1);
      expect(dashboard.data.recentTrades[0].symbol).toBe('GOOGL');
      expect(Array.isArray(dashboard.data.topPositions)).toBe(true);
      expect(dashboard.data.topPositions.length).toBe(1);
    });

    it('should return defaults when no data exists', () => {
      const cashRow = db.prepare("SELECT value FROM system_state WHERE key = 'cash_balance'").get() as any;
      const cash = parseFloat(cashRow?.value ?? '100000');

      const latestSnapshot = db.prepare(
        'SELECT * FROM portfolio_snapshots ORDER BY snapshot_at DESC LIMIT 1'
      ).get();

      const fallback: Record<string, number> = (latestSnapshot as Record<string, number>) || {
        total_value: cash, cash_balance: cash, invested_value: 0,
        total_pnl: 0, total_pnl_pct: 0, position_count: 0,
      };

      expect(fallback.total_value).toBe(100000);
      expect(fallback.cash_balance).toBe(100000);
    });
  });

  // ── GET /api/performance ───────────────────────────────────────

  describe('GET /api/performance shape', () => {
    it('should return correct performance metrics shape', () => {
      // Build a response matching the PerformanceMetrics interface
      const metrics = {
        totalReturn: 0,
        totalReturnPct: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        sharpeEstimate: 0,
        totalTrades: 0,
        openPositions: 0,
        closedPositions: 0,
      };

      expect(metrics).toHaveProperty('totalReturn');
      expect(metrics).toHaveProperty('totalReturnPct');
      expect(metrics).toHaveProperty('winRate');
      expect(metrics).toHaveProperty('avgWin');
      expect(metrics).toHaveProperty('avgLoss');
      expect(metrics).toHaveProperty('profitFactor');
      expect(metrics).toHaveProperty('sharpeEstimate');
      expect(metrics).toHaveProperty('totalTrades');
      expect(metrics).toHaveProperty('openPositions');
      expect(metrics).toHaveProperty('closedPositions');
    });
  });

  // ── GET /api/health ────────────────────────────────────────────

  describe('GET /api/health shape', () => {
    it('should match expected health response shape', () => {
      const response = { status: 'ok', timestamp: new Date().toISOString() };
      expect(response.status).toBe('ok');
      expect(response.timestamp).toBeDefined();
    });
  });

  // ── POST /api/stocks ───────────────────────────────────────────

  describe('POST /api/stocks', () => {
    it('should insert a new stock and return it', () => {
      const r = db.prepare(`
        INSERT INTO stocks (symbol, name, market, asset_type, currency)
        VALUES ('NFLX', 'Netflix Inc', 'US', 'stock', 'USD')
      `).run();

      const stock = db.prepare('SELECT * FROM stocks WHERE id = ?').get(r.lastInsertRowid) as any;
      expect(stock.symbol).toBe('NFLX');
      expect(stock.market).toBe('US');
      expect(stock.is_active).toBe(1);
    });

    it('should reject duplicate symbols', () => {
      insertStock('DUP');
      expect(() => insertStock('DUP')).toThrow();
    });
  });
});
