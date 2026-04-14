/**
 * Alpha Vantage API integration for APEX.
 *
 * Provides company fundamentals (OVERVIEW endpoint) as a supplementary
 * data source alongside Yahoo Finance. Designed to be conservative with
 * the free-tier rate limit (25 requests/day, 5/minute).
 *
 * All fetches are cached for 24 hours and failures degrade gracefully.
 */
import axios from 'axios';
import { getDb } from '../db';
import { logActivity } from './activityLogger';

// ─── Types ──────────────────────────────────────────────────────

export interface AlphaVantageOverview {
  symbol: string;
  forwardPE: number | null;
  pegRatio: number | null;
  analystTargetPrice: number | null;
  beta: number | null;
  bookValue: number | null;
  priceToBook: number | null;
  evToRevenue: number | null;
  evToEbitda: number | null;
  quarterlyRevenueGrowthYOY: number | null;
  quarterlyEarningsGrowthYOY: number | null;
  // Additional fields we capture but don't put on MarketData
  name: string | null;
  sector: string | null;
  industry: string | null;
  dividendYield: number | null;
  profitMargin: number | null;
  operatingMarginTTM: number | null;
  returnOnEquityTTM: number | null;
  revenuePerShareTTM: number | null;
  fetchedAt: string;
}

// ─── Configuration ──────────────────────────────────────────────

const API_KEY = () => process.env.ALPHA_VANTAGE_MCP_API_KEY || '';
const BASE_URL = 'https://www.alphavantage.co/query';
const CACHE_TTL_MINUTES = 1440; // 24 hours
const MAX_CALLS_PER_MINUTE = 5;
const MAX_CALLS_PER_DAY = 25;

// ─── Rate limiter ───────────────────────────────────────────────

interface RateLimiterState {
  minuteTimestamps: number[];
  dailyCount: number;
  dailyResetDate: string; // YYYY-MM-DD
}

const rateLimiter: RateLimiterState = {
  minuteTimestamps: [],
  dailyCount: 0,
  dailyResetDate: new Date().toISOString().slice(0, 10),
};

function resetDailyIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (rateLimiter.dailyResetDate !== today) {
    rateLimiter.dailyCount = 0;
    rateLimiter.dailyResetDate = today;
  }
}

function canMakeRequest(): { allowed: boolean; reason?: string } {
  resetDailyIfNeeded();

  // Check daily limit
  if (rateLimiter.dailyCount >= MAX_CALLS_PER_DAY) {
    return { allowed: false, reason: `Daily limit reached (${MAX_CALLS_PER_DAY}/day)` };
  }

  // Warn when approaching daily limit
  if (rateLimiter.dailyCount >= MAX_CALLS_PER_DAY - 5) {
    logActivity('warn', 'system', `Alpha Vantage approaching daily limit: ${rateLimiter.dailyCount}/${MAX_CALLS_PER_DAY} calls used`, undefined, undefined, 2);
  }

  // Check per-minute limit
  const oneMinuteAgo = Date.now() - 60_000;
  rateLimiter.minuteTimestamps = rateLimiter.minuteTimestamps.filter(t => t > oneMinuteAgo);
  if (rateLimiter.minuteTimestamps.length >= MAX_CALLS_PER_MINUTE) {
    return { allowed: false, reason: `Per-minute limit reached (${MAX_CALLS_PER_MINUTE}/min)` };
  }

  return { allowed: true };
}

function recordRequest(): void {
  rateLimiter.minuteTimestamps.push(Date.now());
  rateLimiter.dailyCount++;
}

/** Expose rate-limit stats for diagnostics / status endpoint */
export function getRateLimitStatus(): { dailyUsed: number; dailyLimit: number; minuteUsed: number; minuteLimit: number } {
  resetDailyIfNeeded();
  const oneMinuteAgo = Date.now() - 60_000;
  rateLimiter.minuteTimestamps = rateLimiter.minuteTimestamps.filter(t => t > oneMinuteAgo);
  return {
    dailyUsed: rateLimiter.dailyCount,
    dailyLimit: MAX_CALLS_PER_DAY,
    minuteUsed: rateLimiter.minuteTimestamps.length,
    minuteLimit: MAX_CALLS_PER_MINUTE,
  };
}

// ─── Cache helpers (same pattern as other API modules) ──────────

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
    console.warn('[AlphaVantage] Cache write failed:', err);
  }
}

// Ensure table exists on import
try { ensureCacheTable(); } catch { /* first boot */ }

// ─── Helpers ────────────────────────────────────────────────────

function safeFloat(val: unknown): number | null {
  if (val == null || val === 'None' || val === '-' || val === '') return null;
  const n = parseFloat(String(val));
  return isFinite(n) ? n : null;
}

// ─── Company Overview ───────────────────────────────────────────

/**
 * Fetch company fundamentals from Alpha Vantage OVERVIEW endpoint.
 * Returns null on failure or rate-limit — never throws.
 * Cached for 24 hours via `av:overview:<symbol>`.
 */
export async function fetchCompanyOverview(symbol: string): Promise<AlphaVantageOverview | null> {
  const apiKey = API_KEY();
  if (!apiKey) {
    logActivity('warn', 'system', 'Alpha Vantage API key not configured', symbol, undefined, 4);
    return null;
  }

  // Check cache first
  const cacheKey = `av:overview:${symbol}`;
  const cached = getCached<AlphaVantageOverview>(cacheKey);
  if (cached) {
    logActivity('info', 'signal', 'Alpha Vantage overview loaded from cache', symbol, undefined, 5);
    return cached;
  }

  // Check rate limits before making request
  const rateCheck = canMakeRequest();
  if (!rateCheck.allowed) {
    logActivity('warn', 'signal', `Alpha Vantage rate-limited: ${rateCheck.reason}`, symbol, undefined, 3);
    return null;
  }

  try {
    const t0 = Date.now();
    recordRequest();

    const response = await axios.get(BASE_URL, {
      params: {
        function: 'OVERVIEW',
        symbol,
        apikey: apiKey,
      },
      timeout: 15_000,
    });

    const data = response.data;

    // Alpha Vantage returns a Note or Information key on rate-limit / errors
    if (data.Note || data.Information) {
      const msg = data.Note || data.Information;
      logActivity('warn', 'signal', `Alpha Vantage API message: ${msg}`, symbol, { message: msg }, 3);
      return null;
    }

    // Empty response (invalid symbol, etc.)
    if (!data.Symbol) {
      logActivity('warn', 'signal', 'Alpha Vantage returned empty overview', symbol, undefined, 4);
      return null;
    }

    const overview: AlphaVantageOverview = {
      symbol: data.Symbol,
      forwardPE: safeFloat(data.ForwardPE),
      pegRatio: safeFloat(data.PEGRatio),
      analystTargetPrice: safeFloat(data.AnalystTargetPrice),
      beta: safeFloat(data.Beta),
      bookValue: safeFloat(data.BookValue),
      priceToBook: safeFloat(data.PriceToBookRatio),
      evToRevenue: safeFloat(data.EVToRevenue),
      evToEbitda: safeFloat(data.EVToEBITDA),
      quarterlyRevenueGrowthYOY: safeFloat(data.QuarterlyRevenueGrowthYOY),
      quarterlyEarningsGrowthYOY: safeFloat(data.QuarterlyEarningsGrowthYOY),
      name: data.Name || null,
      sector: data.Sector || null,
      industry: data.Industry || null,
      dividendYield: safeFloat(data.DividendYield),
      profitMargin: safeFloat(data.ProfitMargin),
      operatingMarginTTM: safeFloat(data.OperatingMarginTTM),
      returnOnEquityTTM: safeFloat(data.ReturnOnEquityTTM),
      revenuePerShareTTM: safeFloat(data.RevenuePerShareTTM),
      fetchedAt: new Date().toISOString(),
    };

    const durationMs = Date.now() - t0;

    // Cache for 24 hours
    setCache(cacheKey, overview, CACHE_TTL_MINUTES);

    logActivity('info', 'signal', `Fetched Alpha Vantage fundamentals for ${symbol}`, symbol, {
      durationMs,
      forwardPE: overview.forwardPE,
      pegRatio: overview.pegRatio,
      analystTargetPrice: overview.analystTargetPrice,
      beta: overview.beta,
    }, 3);

    logActivity('info', 'signal', `AV Overview: forwardPE=${overview.forwardPE}, PEG=${overview.pegRatio}, analystTarget=$${overview.analystTargetPrice}`, symbol, {
      forwardPE: overview.forwardPE,
      pegRatio: overview.pegRatio,
      analystTargetPrice: overview.analystTargetPrice,
      beta: overview.beta,
      bookValue: overview.bookValue,
      priceToBook: overview.priceToBook,
      evToRevenue: overview.evToRevenue,
      evToEbitda: overview.evToEbitda,
      sector: overview.sector,
      industry: overview.industry,
    }, 4);

    logActivity('info', 'signal', 'AV raw response received', symbol, { raw: data }, 5);

    return overview;
  } catch (err: any) {
    logActivity('error', 'signal', `Alpha Vantage fetch failed: ${err.message}`, symbol, { error: err.message }, 3);
    return null;
  }
}

/**
 * Check if Alpha Vantage is configured and usable.
 */
export function isAlphaVantageConfigured(): boolean {
  return !!API_KEY();
}
