import { getDb } from '../../db';

// ─── Types ──────────────────────────────────────────────────────

export interface SearchTrendData {
  currentInterest: number;
  previousInterest: number;
  trend: 'rising' | 'falling' | 'stable';
  changePercent: number;
}

// ─── Cache helpers ──────────────────────────────────────────────

const TRENDS_CACHE_MINUTES = 360; // 6 hours

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
    console.warn('[GoogleTrends] Cache write failed:', err);
  }
}

// ─── Neutral fallback ──────────────────────────────────────────

function neutralResult(): SearchTrendData {
  return {
    currentInterest: 50,
    previousInterest: 50,
    trend: 'stable',
    changePercent: 0,
  };
}

// ─── Google Trends API ─────────────────────────────────────────

/**
 * Fetch search interest data for a stock symbol using google-trends-api.
 * Compares last 7 days vs previous 7 days.
 * Returns neutral data on any failure (Google Trends can be flaky).
 */
export async function fetchSearchTrend(symbol: string, companyName?: string): Promise<SearchTrendData> {
  ensureCacheTable();

  const cacheKey = `trends:${symbol}`;
  const cached = getCached<SearchTrendData>(cacheKey);
  if (cached) return cached;

  try {
    // Dynamic import — google-trends-api is a CommonJS module
    const googleTrends = await import('google-trends-api');

    // Search for the stock ticker and company name together for better results
    const keyword = companyName ? `${symbol} ${companyName} stock` : `${symbol} stock`;

    const result = await googleTrends.interestOverTime({
      keyword,
      startTime: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // 14 days ago
      endTime: new Date(),
      geo: '', // worldwide
    });

    const parsed = JSON.parse(result);
    const timelineData = parsed?.default?.timelineData;

    if (!Array.isArray(timelineData) || timelineData.length < 2) {
      return neutralResult();
    }

    // Split into two halves: previous period vs current period
    const midpoint = Math.floor(timelineData.length / 2);
    const previousData = timelineData.slice(0, midpoint);
    const currentData = timelineData.slice(midpoint);

    const avgInterest = (data: any[]): number => {
      if (data.length === 0) return 50;
      const sum = data.reduce((s: number, d: any) => s + (d.value?.[0] ?? 0), 0);
      return Math.round(sum / data.length);
    };

    const currentInterest = avgInterest(currentData);
    const previousInterest = avgInterest(previousData);

    let trend: SearchTrendData['trend'] = 'stable';
    let changePercent = 0;

    if (previousInterest > 0) {
      changePercent = Math.round(((currentInterest - previousInterest) / previousInterest) * 100);
    }

    if (changePercent > 10) trend = 'rising';
    else if (changePercent < -10) trend = 'falling';

    const data: SearchTrendData = {
      currentInterest,
      previousInterest,
      trend,
      changePercent,
    };

    setCache(cacheKey, data, TRENDS_CACHE_MINUTES);
    return data;
  } catch (err: any) {
    console.warn(`[GoogleTrends] Fetch failed for ${symbol}: ${err.message}`);
    return neutralResult();
  }
}
