import axios from 'axios';
import { getDb } from '../../db';
import { ensureYahooCrumb } from '../marketData';

// ─── Types ──────────────────────────────────────────────────────

export interface FundamentalData {
  symbol: string;
  peRatio: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  eps: number | null;
  marketCap: number | null;
  week52High: number | null;
  week52Low: number | null;
  revenueGrowth: number | null;
  profitMargin: number | null;
  fetchedAt: string;
}

// ─── Cache helpers ──────────────────────────────────────────────

const FUNDAMENTALS_CACHE_MINUTES = 240; // 4 hours

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
    console.warn('[YahooFundamentals] Cache write failed:', err);
  }
}

// ─── Yahoo Finance v10 quoteSummary ─────────────────────────────

function extractNumber(obj: any, key: string): number | null {
  if (!obj) return null;
  const val = obj[key];
  if (val == null) return null;
  // Yahoo returns { raw: 14.2, fmt: '14.20' } or plain numbers
  if (typeof val === 'object' && val.raw != null) return val.raw;
  if (typeof val === 'number' && isFinite(val)) return val;
  return null;
}

/**
 * Fetch real fundamental data from Yahoo Finance quoteSummary API.
 * Returns nulls on failure — never throws.
 */
export async function fetchFundamentals(symbol: string): Promise<FundamentalData> {
  ensureCacheTable();

  const cacheKey = `fundamentals:${symbol}`;
  const cached = getCached<FundamentalData>(cacheKey);
  if (cached) return cached;

  const emptyResult: FundamentalData = {
    symbol,
    peRatio: null,
    pbRatio: null,
    dividendYield: null,
    eps: null,
    marketCap: null,
    week52High: null,
    week52Low: null,
    revenueGrowth: null,
    profitMargin: null,
    fetchedAt: new Date().toISOString(),
  };

  try {
    const { crumb, cookie } = await ensureYahooCrumb();
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`;
    const resp = await axios.get(url, {
      params: {
        modules: 'defaultKeyStatistics,financialData,summaryDetail',
        crumb,
      },
      timeout: 15_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Cookie: cookie,
      },
    });

    const result = resp.data?.quoteSummary?.result?.[0];
    if (!result) return emptyResult;

    const keyStats = result.defaultKeyStatistics || {};
    const financialData = result.financialData || {};
    const summaryDetail = result.summaryDetail || {};

    const data: FundamentalData = {
      symbol,
      peRatio: extractNumber(summaryDetail, 'trailingPE'),
      pbRatio: extractNumber(keyStats, 'priceToBook'),
      dividendYield: extractNumber(summaryDetail, 'dividendYield'),
      eps: extractNumber(keyStats, 'trailingEps') ?? extractNumber(financialData, 'earningsGrowth'),
      marketCap: extractNumber(summaryDetail, 'marketCap'),
      week52High: extractNumber(summaryDetail, 'fiftyTwoWeekHigh'),
      week52Low: extractNumber(summaryDetail, 'fiftyTwoWeekLow'),
      revenueGrowth: extractNumber(financialData, 'revenueGrowth'),
      profitMargin: extractNumber(financialData, 'profitMargins'),
      fetchedAt: new Date().toISOString(),
    };

    setCache(cacheKey, data, FUNDAMENTALS_CACHE_MINUTES);
    return data;
  } catch (err: any) {
    if (err.response?.status === 429) {
      console.warn(`[YahooFundamentals] Rate limited for ${symbol}`);
    } else {
      console.warn(`[YahooFundamentals] Fetch failed for ${symbol}: ${err.message}`);
    }
    return emptyResult;
  }
}
