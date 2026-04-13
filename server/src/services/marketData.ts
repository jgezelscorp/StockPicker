import axios, { type AxiosInstance } from 'axios';
import { getDb } from '../db';

// ─── Types ──────────────────────────────────────────────────────

export interface StockQuote {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  volume: number;
  marketCap: number | null;
  pe: number | null;
  name: string;
  currency: string;
  exchange: string;
}

export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketOverview {
  region: string;
  indices: { symbol: string; name: string; price: number; changePct: number }[];
  updatedAt: string;
}

// ─── Cache helpers ──────────────────────────────────────────────

const QUOTE_CACHE_MINUTES = 5;
const HISTORICAL_CACHE_MINUTES = 60;

function ensureCacheTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_data_cache (
      cache_key   TEXT PRIMARY KEY,
      data        TEXT NOT NULL,
      expires_at  TEXT NOT NULL
    )
  `);
}

function getCached<T>(key: string): T | null {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT data FROM market_data_cache WHERE cache_key = ? AND expires_at > datetime('now')"
    ).get(key) as any;
    if (row) return JSON.parse(row.data) as T;
  } catch { /* miss */ }
  return null;
}

function setCache(key: string, data: unknown, ttlMinutes: number): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO market_data_cache (cache_key, data, expires_at)
      VALUES (?, ?, datetime('now', '+' || ? || ' minutes'))
    `).run(key, JSON.stringify(data), ttlMinutes);
  } catch (err) {
    console.warn('[MarketData] Cache write failed:', err);
  }
}

// ─── Yahoo Finance v8 (unofficial, no key required) ─────────────

const yahoo: AxiosInstance = axios.create({
  baseURL: 'https://query1.finance.yahoo.com',
  timeout: 15_000,
  headers: { 'User-Agent': 'APEX/1.0' },
});

// Rate limiter — max 5 requests per second
let lastRequestTime = 0;
const MIN_REQUEST_GAP_MS = 200;

async function throttle(): Promise<void> {
  const now = Date.now();
  const gap = now - lastRequestTime;
  if (gap < MIN_REQUEST_GAP_MS) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_GAP_MS - gap));
  }
  lastRequestTime = Date.now();
}

// Map market suffixes for non-US symbols
function yahooSymbol(symbol: string, market?: string): string {
  if (!market || market === 'US') return symbol;
  // European symbols typically have exchange suffix already (e.g., VOW3.DE, OR.PA)
  // Asian symbols have .T (Tokyo), .HK, .SS (Shanghai), etc.
  // If the symbol already has a dot suffix, leave it
  if (symbol.includes('.')) return symbol;
  return symbol;
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Fetch a real-time quote for a symbol using Yahoo Finance.
 */
export async function fetchStockQuote(symbol: string, market?: string): Promise<StockQuote | null> {
  ensureCacheTable();
  const cacheKey = `quote:${symbol}`;
  const cached = getCached<StockQuote>(cacheKey);
  if (cached) return cached;

  try {
    await throttle();
    const ySymbol = yahooSymbol(symbol, market);
    const resp = await yahoo.get('/v8/finance/chart/' + encodeURIComponent(ySymbol), {
      params: { interval: '1d', range: '2d' },
    });

    const meta = resp.data?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const indicators = resp.data.chart.result[0].indicators?.quote?.[0];
    const timestamps = resp.data.chart.result[0].timestamp || [];
    const lastIdx = timestamps.length - 1;

    const price = meta.regularMarketPrice ?? (indicators?.close?.[lastIdx] || 0);
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = price - previousClose;
    const changePct = previousClose > 0 ? (change / previousClose) * 100 : 0;

    const quote: StockQuote = {
      symbol: symbol.toUpperCase(),
      price,
      previousClose,
      change,
      changePct,
      volume: meta.regularMarketVolume ?? (indicators?.volume?.[lastIdx] || 0),
      marketCap: null,
      pe: null,
      name: meta.shortName || meta.longName || symbol,
      currency: meta.currency || 'USD',
      exchange: meta.exchangeName || '',
    };

    setCache(cacheKey, quote, QUOTE_CACHE_MINUTES);
    return quote;
  } catch (err: any) {
    if (err.response?.status === 429) {
      console.warn(`[MarketData] Rate limited for ${symbol}, will retry later`);
    } else {
      console.error(`[MarketData] Quote fetch failed for ${symbol}:`, err.message);
    }
    return null;
  }
}

/**
 * Fetch historical OHLCV prices.
 * @param period - '1mo', '3mo', '6mo', '1y', '2y', '5y'
 */
export async function fetchHistoricalPrices(
  symbol: string,
  period: string = '3mo',
  market?: string
): Promise<HistoricalPrice[]> {
  ensureCacheTable();
  const cacheKey = `hist:${symbol}:${period}`;
  const cached = getCached<HistoricalPrice[]>(cacheKey);
  if (cached) return cached;

  try {
    await throttle();
    const ySymbol = yahooSymbol(symbol, market);
    const resp = await yahoo.get('/v8/finance/chart/' + encodeURIComponent(ySymbol), {
      params: { interval: '1d', range: period },
    });

    const result = resp.data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps: number[] = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const prices: HistoricalPrice[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      if (q.close?.[i] == null) continue;
      prices.push({
        date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
        open: q.open?.[i] ?? 0,
        high: q.high?.[i] ?? 0,
        low: q.low?.[i] ?? 0,
        close: q.close[i],
        volume: q.volume?.[i] ?? 0,
      });
    }

    if (prices.length > 0) {
      setCache(cacheKey, prices, HISTORICAL_CACHE_MINUTES);
    }
    return prices;
  } catch (err: any) {
    console.error(`[MarketData] Historical fetch failed for ${symbol}:`, err.message);
    return [];
  }
}

/**
 * Fetch a market overview — key indices for a region.
 */
export async function fetchMarketOverview(region: string = 'US'): Promise<MarketOverview> {
  ensureCacheTable();
  const cacheKey = `overview:${region}`;
  const cached = getCached<MarketOverview>(cacheKey);
  if (cached) return cached;

  const regionIndices: Record<string, { symbol: string; name: string }[]> = {
    US: [
      { symbol: '^GSPC', name: 'S&P 500' },
      { symbol: '^DJI', name: 'Dow Jones' },
      { symbol: '^IXIC', name: 'NASDAQ' },
    ],
    EU: [
      { symbol: '^STOXX50E', name: 'Euro Stoxx 50' },
      { symbol: '^FTSE', name: 'FTSE 100' },
      { symbol: '^GDAXI', name: 'DAX' },
    ],
    ASIA: [
      { symbol: '^N225', name: 'Nikkei 225' },
      { symbol: '^HSI', name: 'Hang Seng' },
      { symbol: '000001.SS', name: 'Shanghai Composite' },
    ],
  };

  const targets = regionIndices[region] || regionIndices['US'];
  const indices: MarketOverview['indices'] = [];

  for (const idx of targets) {
    const quote = await fetchStockQuote(idx.symbol);
    if (quote) {
      indices.push({
        symbol: idx.symbol,
        name: idx.name,
        price: quote.price,
        changePct: quote.changePct,
      });
    }
  }

  const overview: MarketOverview = {
    region,
    indices,
    updatedAt: new Date().toISOString(),
  };

  if (indices.length > 0) {
    setCache(cacheKey, overview, QUOTE_CACHE_MINUTES);
  }
  return overview;
}

/**
 * Update current_price and market_value for all open positions.
 */
export async function refreshPositionPrices(): Promise<number> {
  const db = getDb();
  const positions = db.prepare(`
    SELECT pp.id, pp.quantity, pp.average_cost, s.symbol, s.market
    FROM portfolio_positions pp
    JOIN stocks s ON s.id = pp.stock_id
    WHERE pp.quantity > 0
  `).all() as any[];

  let updated = 0;
  for (const pos of positions) {
    const quote = await fetchStockQuote(pos.symbol, pos.market);
    if (quote && quote.price > 0) {
      const marketValue = pos.quantity * quote.price;
      const unrealisedPnl = (quote.price - pos.average_cost) * pos.quantity;
      const unrealisedPnlPct = pos.average_cost > 0
        ? ((quote.price - pos.average_cost) / pos.average_cost) * 100
        : 0;

      db.prepare(`
        UPDATE portfolio_positions
        SET current_price = ?, market_value = ?,
            unrealised_pnl = ?, unrealised_pnl_pct = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(quote.price, marketValue, unrealisedPnl, unrealisedPnlPct, pos.id);
      updated++;
    }
  }
  return updated;
}

/**
 * Fetch fundamental data for a symbol.
 * Wraps the yahooFundamentals API module.
 */
export async function fetchFundamentals(symbol: string): Promise<import('./apis/yahooFundamentals').FundamentalData> {
  const { fetchFundamentals: fetchFundamentalsApi } = await import('./apis/yahooFundamentals');
  return fetchFundamentalsApi(symbol);
}

/**
 * Clean up expired cache entries.
 */
export function purgeExpiredCache(): void {
  try {
    ensureCacheTable();
    const db = getDb();
    db.prepare("DELETE FROM market_data_cache WHERE expires_at <= datetime('now')").run();
  } catch { /* ignore */ }
}
