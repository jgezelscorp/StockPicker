import { Router } from 'express';
import { getDb } from '../db';
import {
  getPortfolio,
  getPortfolioHistory,
  getTradeHistory,
  takeSnapshot,
  getPerformanceMetrics,
  getDecisionQualityAnalysis,
} from '../services/portfolioTracker';
import {
  fetchStockQuote,
  fetchMarketOverview,
  fetchHistoricalPrices,
  fetchChartData,
  fetchExtendedFundamentals,
} from '../services/marketData';
import {
  calcSMA, calcEMA, calcRSI, calcMACD, calcBollinger, calcATR,
  calcSMASeries, calcEMASeries, calcBollingerSeries, calcRSISeries, calcMACDSeries,
} from '../services/technicalIndicators';
import { getPortfolioValue, getCashBalance } from '../services/tradingEngine';
import {
  runAnalysisPipeline,
  runStockDiscovery,
} from '../services/scheduler';
import { getRecentLogs, onLog } from '../services/activityLogger';
import { DEFAULT_SCHEDULER_CONFIG } from '../types';
import { getLLMStatus } from '../services/llm';

const router = Router();

// ─── Portfolio ──────────────────────────────────────────────────

router.get('/portfolio', (_req, res) => {
  try {
    const p = getPortfolio();
    res.json({ success: true, data: {
      total_value: p.totalValue,
      cash_balance: p.cashBalance,
      invested_value: p.investedValue,
      total_pnl: p.totalPnl,
      total_pnl_pct: p.totalPnlPct,
      position_count: p.positionCount,
    }});
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/portfolio/positions', (_req, res) => {
  try {
    const p = getPortfolio();
    res.json({ success: true, data: p.positions.map(pos => ({
      id: pos.id,
      stock_id: pos.stockId,
      symbol: pos.symbol,
      name: pos.name,
      market: pos.market,
      sector: pos.sector,
      quantity: pos.quantity,
      average_cost: pos.averageCost,
      current_price: pos.currentPrice,
      market_value: pos.marketValue,
      unrealised_pnl: pos.unrealisedPnl,
      unrealised_pnl_pct: pos.unrealisedPnlPct,
      opened_at: pos.openedAt,
      updated_at: pos.updatedAt,
    }))});
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/portfolio/history', (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 90;
    const history = getPortfolioHistory(days);
    res.json({ success: true, data: history });
  } catch (err: any) {

    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Cash Balance Adjustment ─────────────────────────────────────
router.post('/portfolio/adjust-cash', (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (typeof amount !== 'number' || !isFinite(amount) || amount === 0) {
      res.status(400).json({ success: false, error: 'amount must be a non-zero number' });
      return;
    }
    const db = getDb();
    const current = db.prepare(
      "SELECT value FROM system_state WHERE key = 'cash_balance'"
    ).get() as any;
    const oldBalance = parseFloat(current?.value ?? '100000');
    const newBalance = oldBalance + amount;
    if (newBalance < 0) {
      res.status(400).json({ success: false, error: `Insufficient cash. Current: $${oldBalance.toFixed(2)}, adjustment: $${amount.toFixed(2)}` });
      return;
    }
    db.prepare(
      "UPDATE system_state SET value = ? WHERE key = 'cash_balance'"
    ).run(String(newBalance));

    // Log the adjustment in activity_log if the table exists
    try {
      db.prepare(`
        INSERT INTO activity_log (category, level, message, details, verbosity, created_at)
        VALUES ('trade', 'info', ?, ?, 2, datetime('now'))
      `).run(
        `Cash balance adjusted by ${amount >= 0 ? '+' : ''}$${amount.toFixed(2)}${reason ? ': ' + reason : ''}`,
        JSON.stringify({ old_balance: oldBalance, new_balance: newBalance, amount, reason: reason || null })
      );
    } catch (_) { /* activity_log table may not exist yet */ }

    res.json({
      success: true,
      data: {
        old_balance: oldBalance,
        new_balance: newBalance,
        adjustment: amount,
        reason: reason || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Trades ─────────────────────────────────────────────────────

router.get('/trades', (req, res) => {
  try {
    const filters = {
      symbol: req.query.symbol as string | undefined,
      action: req.query.action as 'buy' | 'sell' | undefined,
      fromDate: req.query.from as string | undefined,
      toDate: req.query.to as string | undefined,
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
    };
    const result = getTradeHistory(filters);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/trades/:id', (req, res) => {
  try {
    const db = getDb();
    const trade = db.prepare(`
      SELECT t.*, s.symbol, s.name as stock_name, s.market, s.sector
      FROM trades t
      JOIN stocks s ON s.id = t.stock_id
      WHERE t.id = ?
    `).get(parseInt(req.params.id)) as any;

    if (!trade) {
      res.status(404).json({ success: false, error: 'Trade not found' });
      return;
    }

    // Also fetch the analysis log closest to this trade's execution
    const analysis = db.prepare(`
      SELECT * FROM analysis_logs
      WHERE stock_id = ? AND analysed_at <= ?
      ORDER BY analysed_at DESC LIMIT 1
    `).get(trade.stock_id, trade.executed_at);

    // Fetch learning outcome if evaluated
    const outcome = db.prepare(
      'SELECT * FROM learning_outcomes WHERE trade_id = ?'
    ).get(trade.id);

    res.json({
      success: true,
      data: {
        ...trade,
        analysis: analysis || null,
        learningOutcome: outcome || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Signals ────────────────────────────────────────────────────

router.get('/signals/:symbol', (req, res) => {
  try {
    const db = getDb();
    const symbol = req.params.symbol.toUpperCase();

    const stock = db.prepare(
      'SELECT id FROM stocks WHERE symbol = ?'
    ).get(symbol) as any;

    if (!stock) {
      res.status(404).json({ success: false, error: `Stock ${symbol} not found` });
      return;
    }

    // Get the most recent signals for each source
    const signals = db.prepare(`
      SELECT s1.* FROM signals s1
      INNER JOIN (
        SELECT source, MAX(captured_at) as max_time
        FROM signals WHERE stock_id = ?
        GROUP BY source
      ) s2 ON s1.source = s2.source AND s1.captured_at = s2.max_time
      WHERE s1.stock_id = ?
      ORDER BY s1.source
    `).all(stock.id, stock.id);

    // Get latest analysis
    const latestAnalysis = db.prepare(`
      SELECT * FROM analysis_logs
      WHERE stock_id = ?
      ORDER BY analysed_at DESC LIMIT 1
    `).get(stock.id);

    res.json({
      success: true,
      data: {
        symbol,
        signals,
        latestAnalysis: latestAnalysis || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Analysis & Performance ─────────────────────────────────────

router.get('/analysis/performance', (_req, res) => {
  try {
    const metrics = getPerformanceMetrics();
    res.json({ success: true, data: metrics });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/analysis/decisions', (_req, res) => {
  try {
    const analysis = getDecisionQualityAnalysis();
    res.json({ success: true, data: analysis });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Watchlist ──────────────────────────────────────────────────

router.get('/watchlist', (req, res) => {
  try {
    const db = getDb();
    const { type } = req.query;
    
    // Build WHERE clause with optional type filtering
    let whereClause = 's.is_active = 1';
    const params: any[] = [];
    
    if (type && (type === 'stock' || type === 'etf')) {
      whereClause += ' AND s.asset_type = ?';
      params.push(type);
    }
    
    const stocks = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM signals WHERE stock_id = s.id) as signal_count,
        (SELECT COUNT(*) FROM trades WHERE stock_id = s.id) as trade_count,
        (SELECT pp.quantity FROM portfolio_positions pp WHERE pp.stock_id = s.id AND pp.quantity > 0) as held_quantity,
        (SELECT MAX(al.analysed_at) FROM analysis_logs al WHERE al.stock_id = s.id) as last_analysed_at
      FROM stocks s
      WHERE ${whereClause}
      ORDER BY s.symbol ASC
    `).all(...params);
    res.json({ success: true, data: stocks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/watchlist', (req, res) => {
  try {
    const db = getDb();
    const { symbol, name, market, assetType, sector, currency } = req.body;

    if (!symbol || !name || !market) {
      res.status(400).json({
        success: false,
        error: 'symbol, name, and market are required',
      });
      return;
    }

    const validMarkets = ['US', 'EU', 'ASIA'];
    if (!validMarkets.includes(market)) {
      res.status(400).json({
        success: false,
        error: `market must be one of: ${validMarkets.join(', ')}`,
      });
      return;
    }

    // Check for duplicate
    const existing = db.prepare(
      'SELECT id, is_active FROM stocks WHERE symbol = ?'
    ).get(symbol.toUpperCase()) as any;

    if (existing) {
      if (!existing.is_active) {
        // Re-activate
        db.prepare('UPDATE stocks SET is_active = 1 WHERE id = ?').run(existing.id);
        const stock = db.prepare('SELECT * FROM stocks WHERE id = ?').get(existing.id);
        res.json({ success: true, data: stock, message: 'Stock reactivated' });
        return;
      }
      res.status(409).json({ success: false, error: `${symbol} is already on the watchlist` });
      return;
    }

    const result = db.prepare(`
      INSERT INTO stocks (symbol, name, market, asset_type, sector, currency)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      symbol.toUpperCase(), name, market,
      assetType || 'stock', sector || null, currency || 'USD'
    );

    const stock = db.prepare('SELECT * FROM stocks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ success: true, data: stock });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/watchlist/:symbol', (req, res) => {
  try {
    const db = getDb();
    const symbol = req.params.symbol.toUpperCase();

    const stock = db.prepare('SELECT id FROM stocks WHERE symbol = ?').get(symbol) as any;
    if (!stock) {
      res.status(404).json({ success: false, error: `Stock ${symbol} not found` });
      return;
    }

    // Check for open position — can't remove if holding shares
    const position = db.prepare(
      'SELECT quantity FROM portfolio_positions WHERE stock_id = ? AND quantity > 0'
    ).get(stock.id) as any;
    if (position) {
      res.status(400).json({
        success: false,
        error: `Cannot remove ${symbol} — currently holding ${position.quantity} shares`,
      });
      return;
    }

    // Soft delete — just deactivate
    db.prepare('UPDATE stocks SET is_active = 0 WHERE id = ?').run(stock.id);
    res.json({ success: true, message: `${symbol} removed from watchlist` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Dashboard ──────────────────────────────────────────────────

router.get('/dashboard', (_req, res) => {
  try {
    const db = getDb();
    const portfolio = getPortfolio();

    const recentTrades = db.prepare(`
      SELECT t.*, s.symbol, s.name as stock_name
      FROM trades t JOIN stocks s ON s.id = t.stock_id
      ORDER BY t.executed_at DESC LIMIT 10
    `).all();

    // Top signals: most recent analysis results
    const topSignals = db.prepare(`
      SELECT a.*, s.symbol, s.name as stock_name
      FROM analysis_logs a
      JOIN stocks s ON s.id = a.stock_id
      ORDER BY a.analysed_at DESC LIMIT 10
    `).all();

    const lastRun = db.prepare(
      "SELECT value FROM system_state WHERE key = 'last_analysis_run'"
    ).get() as any;

    const watchlistCount = (db.prepare(
      'SELECT COUNT(*) as cnt FROM stocks WHERE is_active = 1'
    ).get() as any).cnt;

    res.json({
      success: true,
      data: {
        portfolio: {
          total_value: portfolio.totalValue,
          cash_balance: portfolio.cashBalance,
          invested_value: portfolio.investedValue,
          total_pnl: portfolio.totalPnl,
          total_pnl_pct: portfolio.totalPnlPct,
          position_count: portfolio.positionCount,
        },
        recentTrades,
        topSignals,
        watchlistCount,
        lastRunAt: lastRun?.value ?? null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Market Data (proxy for client) ────────────────────────────

router.get('/market/quote/:symbol', async (req, res) => {
  try {
    const quote = await fetchStockQuote(req.params.symbol.toUpperCase());
    if (!quote) {
      res.status(404).json({ success: false, error: 'Quote not available' });
      return;
    }
    res.json({ success: true, data: quote });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/market/history/:symbol', async (req, res) => {
  try {
    const period = (req.query.period as string) || '3mo';
    const prices = await fetchHistoricalPrices(req.params.symbol.toUpperCase(), period);
    res.json({ success: true, data: prices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/market/overview', async (req, res) => {
  try {
    const region = (req.query.region as string) || 'US';
    const overview = await fetchMarketOverview(region);
    res.json({ success: true, data: overview });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Stock Detail (rich popup data) ─────────────────────────────

router.get('/stocks/:symbolOrId/detail', async (req, res) => {
  try {
    const db = getDb();
    const param = req.params.symbolOrId;

    // Resolve stock — accept numeric ID or symbol string
    let stock: any = null;
    const asNum = parseInt(param);
    if (!isNaN(asNum) && String(asNum) === param) {
      stock = db.prepare('SELECT * FROM stocks WHERE id = ?').get(asNum);
    }
    if (!stock) {
      stock = db.prepare('SELECT * FROM stocks WHERE symbol = ? COLLATE NOCASE').get(param.toUpperCase());
    }
    if (!stock) {
      res.status(404).json({ success: false, error: `Stock "${param}" not found` });
      return;
    }

    const symbol = stock.symbol;
    const market = stock.market;

    // Fetch all external data in parallel
    const [quote, fundamentals, chart1D, chart1W, chart1M, chart3M, chart1Y, chart3Y] =
      await Promise.all([
        fetchStockQuote(symbol, market),
        fetchExtendedFundamentals(symbol),
        fetchChartData(symbol, '5m', '1d', market),
        fetchChartData(symbol, '60m', '5d', market),
        fetchHistoricalPrices(symbol, '1mo', market),
        fetchHistoricalPrices(symbol, '3mo', market),
        fetchHistoricalPrices(symbol, '1y', market),
        fetchChartData(symbol, '1wk', '3y', market),
      ]);

    // ── Technical indicators from 3M daily data ──
    const closePrices = chart3M.map(p => p.close);
    const highPrices = chart3M.map(p => p.high);
    const lowPrices = chart3M.map(p => p.low);
    const volumes = chart3M.map(p => p.volume);
    const dates3M = chart3M.map(p => p.date);

    const technicals = {
      sma_20: calcSMA(closePrices, 20),
      sma_50: calcSMA(closePrices, 50),
      sma_200: calcSMA(closePrices, 200),
      ema_12: calcEMA(closePrices, 12),
      ema_26: calcEMA(closePrices, 26),
      rsi_14: calcRSI(closePrices, 14),
      macd: calcMACD(closePrices),
      bollinger: calcBollinger(closePrices, 20),
      atr_14: calcATR(highPrices, lowPrices, closePrices, 14),
      volume_sma_20: calcSMA(volumes, 20),
    };

    // ── Indicator series for chart overlays (3M timeframe) ──
    const macdSeries = calcMACDSeries(closePrices, dates3M);
    const bollingerSeries = calcBollingerSeries(closePrices, dates3M, 20);

    const indicator_series = {
      sma_20: calcSMASeries(closePrices, dates3M, 20),
      sma_50: calcSMASeries(closePrices, dates3M, 50),
      ema_12: calcEMASeries(closePrices, dates3M, 12),
      ema_26: calcEMASeries(closePrices, dates3M, 26),
      bollinger_upper: bollingerSeries.upper,
      bollinger_lower: bollingerSeries.lower,
      rsi: calcRSISeries(closePrices, dates3M),
      macd_line: macdSeries.macd_line,
      macd_signal: macdSeries.macd_signal,
      macd_histogram: macdSeries.macd_histogram,
    };

    // ── Latest analysis from DB ──
    const analysisRow = db.prepare(`
      SELECT composite_score, confidence_level, recommendation, rationale,
             signal_breakdown, analysed_at
      FROM analysis_logs WHERE stock_id = ?
      ORDER BY analysed_at DESC LIMIT 1
    `).get(stock.id) as any;

    const latest_analysis = analysisRow
      ? {
          composite_score: analysisRow.composite_score,
          confidence_level: analysisRow.confidence_level,
          recommendation: analysisRow.recommendation,
          rationale: analysisRow.rationale,
          signal_breakdown: (() => {
            try { return typeof analysisRow.signal_breakdown === 'string' ? JSON.parse(analysisRow.signal_breakdown) : analysisRow.signal_breakdown; }
            catch { return null; }
          })(),
          analyzed_at: analysisRow.analysed_at,
        }
      : null;

    // ── Recent trades ──
    const recentTradesRows = db.prepare(`
      SELECT id, action, quantity, price_per_share, total_value,
             confidence, rationale, executed_at
      FROM trades WHERE stock_id = ?
      ORDER BY executed_at DESC LIMIT 20
    `).all(stock.id) as any[];

    const recent_trades = recentTradesRows.map((t: any) => ({
      id: t.id,
      action: t.action,
      quantity: t.quantity,
      price_per_share: t.price_per_share,
      total_value: t.total_value,
      confidence: t.confidence,
      rationale: t.rationale,
      executed_at: t.executed_at,
    }));

    // ── Position (if held) ──
    const posRow = db.prepare(`
      SELECT quantity, average_cost, current_price, market_value,
             unrealised_pnl, unrealised_pnl_pct, opened_at
      FROM portfolio_positions WHERE stock_id = ? AND quantity > 0
    `).get(stock.id) as any;

    const position = posRow
      ? {
          quantity: posRow.quantity,
          average_cost: posRow.average_cost,
          current_price: posRow.current_price,
          market_value: posRow.market_value,
          unrealised_pnl: posRow.unrealised_pnl,
          unrealised_pnl_pct: posRow.unrealised_pnl_pct,
          opened_at: posRow.opened_at,
        }
      : null;

    // ── Build snake_case quote ──
    const quoteData = quote
      ? {
          price: quote.price,
          previous_close: quote.previousClose,
          change: quote.change,
          change_pct: quote.changePct,
          volume: quote.volume,
          market_cap: quote.marketCap,
          pe: quote.pe,
          name: quote.name,
          currency: quote.currency,
          exchange: quote.exchange,
        }
      : null;

    res.json({
      success: true,
      data: {
        stock: {
          id: stock.id,
          symbol: stock.symbol,
          name: stock.name,
          market: stock.market,
          asset_type: stock.asset_type,
          sector: stock.sector,
          currency: stock.currency,
          is_active: stock.is_active,
          created_at: stock.created_at,
        },
        quote: quoteData,
        fundamentals: fundamentals || null,
        charts: {
          '1D': chart1D,
          '1W': chart1W,
          '1M': chart1M,
          '3M': chart3M,
          '1Y': chart1Y,
          '3Y': chart3Y,
        },
        technicals,
        indicator_series,
        latest_analysis,
        recent_trades,
        position,
      },
    });
  } catch (err: any) {
    console.error('[API] Stock detail failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Stock Discovery & Management ──────────────────────────────

router.post('/discover', async (_req, res) => {
  try {
    const result = await runStockDiscovery();
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Event-driven discovery endpoints
router.post('/discover/events', async (_req, res) => {
  try {
    const { runEventDrivenDiscovery } = await import('../services/eventDrivenDiscovery');
    const result = await runEventDrivenDiscovery();
    res.json({
      success: true,
      data: {
        timestamp: result.timestamp,
        events_found: result.events.length,
        symbols_added: result.symbols_added,
        symbols_updated: result.symbols_updated,
        events: result.events,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/discover/events/latest', (_req, res) => {
  try {
    const { getLatestDiscoveryEvents } = require('../services/eventDrivenDiscovery');
    const result = getLatestDiscoveryEvents();
    res.json({
      success: true,
      data: {
        count: result.count,
        events: result.events,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/analyze/run', async (_req, res) => {
  try {
    const result = await runAnalysisPipeline(DEFAULT_SCHEDULER_CONFIG);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/stocks/:id', (req, res) => {
  try {
    const db = getDb();
    const stockId = parseInt(req.params.id);
    if (isNaN(stockId)) {
      res.status(400).json({ success: false, error: 'Invalid stock ID' });
      return;
    }

    const stock = db.prepare('SELECT * FROM stocks WHERE id = ?').get(stockId) as any;
    if (!stock) {
      res.status(404).json({ success: false, error: 'Stock not found' });
      return;
    }

    // Check for open positions
    const position = db.prepare(
      'SELECT quantity FROM portfolio_positions WHERE stock_id = ? AND quantity > 0'
    ).get(stockId) as any;
    if (position) {
      res.status(400).json({
        success: false,
        error: `Cannot remove ${stock.symbol} — currently holding ${position.quantity} shares`,
      });
      return;
    }

    db.prepare('UPDATE stocks SET is_active = 0 WHERE id = ?').run(stockId);
    res.json({ success: true, message: `${stock.symbol} removed from watchlist` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/status', (_req, res) => {
  try {
    const db = getDb();

    const stockCounts = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN market = 'US' AND is_active = 1 THEN 1 ELSE 0 END) as us,
        SUM(CASE WHEN market = 'EU' AND is_active = 1 THEN 1 ELSE 0 END) as eu,
        SUM(CASE WHEN market = 'ASIA' AND is_active = 1 THEN 1 ELSE 0 END) as asia
      FROM stocks
    `).get() as any;

    const lastAnalysis = db.prepare(
      "SELECT value FROM system_state WHERE key = 'last_analysis_run'"
    ).get() as any;

    const lastDiscovery = db.prepare(
      "SELECT value FROM system_state WHERE key = 'last_discovery_run'"
    ).get() as any;

    const apis = {
      yahoo_finance: { configured: true, description: 'No API key needed' },
      finnhub: {
        configured: !!process.env.FINNHUB_API_KEY,
        description: process.env.FINNHUB_API_KEY
          ? 'API key configured'
          : 'Not configured — set FINNHUB_API_KEY for real news data',
      },
      google_trends: { configured: true, description: 'No API key needed (uses google-trends-api package)' },
      alpha_vantage: {
        configured: !!process.env.ALPHA_VANTAGE_MCP_API_KEY,
        description: 'Optional — not used in automated pipeline (Yahoo Finance used instead)',
      },
      llm: {
        ...getLLMStatus(),
        description: getLLMStatus().available
          ? `${getLLMStatus().provider} (${getLLMStatus().model})`
          : 'Not configured — set OPENAI_API_KEY, AZURE_OPENAI_*, or OLLAMA_BASE_URL for AI reasoning',
      },
    };

    res.json({
      success: true,
      data: {
        apis,
        stocks: {
          total: stockCounts.total,
          active: stockCounts.active,
          by_region: {
            US: stockCounts.us,
            EU: stockCounts.eu,
            ASIA: stockCounts.asia,
          },
        },
        total_stocks: stockCounts.active,
        last_analysis_run: lastAnalysis?.value ?? null,
        last_discovery_run: lastDiscovery?.value ?? null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Activity Logs ──────────────────────────────────────────────

router.get('/logs', (req, res) => {
  try {
    const options = {
      limit: parseInt(req.query.limit as string) || 100,
      offset: parseInt(req.query.offset as string) || 0,
      category: req.query.category as string | undefined,
      level: req.query.level as string | undefined,
      since: req.query.since as string | undefined,
      maxVerbosity: req.query.max_verbosity ? parseInt(req.query.max_verbosity as string) : undefined,
    };
    const result = getRecentLogs(options);
    res.json({ success: true, data: { logs: result.logs, total: result.total } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/logs/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  res.write('data: {"type":"connected"}\n\n');

  const maxVerbosity = req.query.max_verbosity ? parseInt(req.query.max_verbosity as string) : 5;

  const cleanup = onLog((entry) => {
    if (entry.verbosity <= maxVerbosity) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }
  });

  req.on('close', cleanup);
});

// ─── Analysis Runs ─────────────────────────────────────────────

router.get('/analysis-runs', (_req, res) => {
  try {
    const db = getDb();
    const runs = db.prepare(`
      SELECT id, started_at, completed_at, duration_ms,
             stocks_analysed, signals_captured, trades_executed,
             errors_count, errors, status, created_at
      FROM analysis_runs
      ORDER BY started_at DESC
      LIMIT 10
    `).all() as any[];

    res.json({ runs });
  } catch (err: any) {
    console.error('[API] Failed to fetch analysis runs:', err);
    res.status(500).json({ error: 'Failed to fetch analysis runs' });
  }
});

export default router;
