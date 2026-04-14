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

// ─── Rate limiter (Google aggressively 429s/302s on burst) ──────

const INTER_REQUEST_DELAY_MS = 2500;   // 2.5 s between calls
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 5000;

let _lastRequestTime = 0;
const _queue: Array<{ resolve: (v: any) => void; reject: (e: any) => void; fn: () => Promise<any> }> = [];
let _processing = false;

async function processQueue(): Promise<void> {
  if (_processing) return;
  _processing = true;
  while (_queue.length > 0) {
    const item = _queue.shift()!;
    const now = Date.now();
    const wait = Math.max(0, INTER_REQUEST_DELAY_MS - (now - _lastRequestTime));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      const result = await item.fn();
      _lastRequestTime = Date.now();
      item.resolve(result);
    } catch (err) {
      _lastRequestTime = Date.now();
      item.reject(err);
    }
  }
  _processing = false;
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    _queue.push({ resolve, reject, fn });
    processQueue();
  });
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

  // Dynamic import — google-trends-api is a CommonJS module; methods are on .default
  const mod = await import('google-trends-api');
  const googleTrends = (mod as any).default ?? mod;

  const keyword = companyName ? `${symbol} ${companyName} stock` : `${symbol} stock`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result: string = await enqueue(() =>
        googleTrends.interestOverTime({
          keyword,
          startTime: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
          endTime: new Date(),
          geo: '',
        }),
      );

      // Detect rate-limit HTML response before parsing JSON
      if (result.includes('<HTML') || result.includes('302 Moved') || result.includes('/sorry/')) {
        if (attempt < MAX_RETRIES) {
          const backoff = RETRY_BACKOFF_MS * (attempt + 1);
          console.warn(`[GoogleTrends] Rate limited for ${symbol}, retry ${attempt + 1} in ${backoff}ms`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }
        console.warn(`[GoogleTrends] Rate limited for ${symbol} after ${MAX_RETRIES + 1} attempts`);
        return neutralResult();
      }

      const parsed = JSON.parse(result);
      const timelineData = parsed?.default?.timelineData;

      if (!Array.isArray(timelineData) || timelineData.length < 2) {
        return neutralResult();
      }

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

      const data: SearchTrendData = { currentInterest, previousInterest, trend, changePercent };
      setCache(cacheKey, data, TRENDS_CACHE_MINUTES);
      return data;
    } catch (err: any) {
      if (attempt < MAX_RETRIES) {
        console.warn(`[GoogleTrends] Attempt ${attempt + 1} failed for ${symbol}: ${err.message}`);
        await new Promise(r => setTimeout(r, RETRY_BACKOFF_MS * (attempt + 1)));
        continue;
      }
      console.warn(`[GoogleTrends] Fetch failed for ${symbol} after ${MAX_RETRIES + 1} attempts: ${err.message}`);
      return neutralResult();
    }
  }

  return neutralResult();
}
