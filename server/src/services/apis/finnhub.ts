import axios from 'axios';
import { getDb } from '../../db';

// ─── Types ──────────────────────────────────────────────────────

export interface NewsArticle {
  headline: string;
  source: string;
  url: string;
  datetime: string;
  summary: string;
  sentiment: number; // -1 to +1
}

// ─── Cache helpers ──────────────────────────────────────────────

const NEWS_CACHE_MINUTES = 120; // 2 hours

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
    console.warn('[Finnhub] Cache write failed:', err);
  }
}

// ─── Keyword-based sentiment scoring ────────────────────────────

const POSITIVE_WORDS = [
  'beats', 'upgrade', 'growth', 'profit', 'record', 'surge', 'rally',
  'gains', 'bullish', 'outperform', 'strong', 'exceeded', 'breakout',
  'innovation', 'partnership', 'expansion', 'dividend', 'buyback',
  'approval', 'recovery', 'optimism', 'beat', 'rises', 'soars',
];

const NEGATIVE_WORDS = [
  'miss', 'downgrade', 'lawsuit', 'recall', 'decline', 'loss', 'crash',
  'bearish', 'underperform', 'weak', 'fell', 'drops', 'warning',
  'fraud', 'investigation', 'layoffs', 'bankruptcy', 'default', 'fine',
  'slump', 'plunge', 'cut', 'debt', 'risk', 'concern', 'uncertainty',
];

function scoreSentiment(text: string): number {
  const lower = text.toLowerCase();
  let positiveCount = 0;
  let negativeCount = 0;

  for (const word of POSITIVE_WORDS) {
    if (lower.includes(word)) positiveCount++;
  }
  for (const word of NEGATIVE_WORDS) {
    if (lower.includes(word)) negativeCount++;
  }

  const total = positiveCount + negativeCount;
  if (total === 0) return 0;
  // Normalize to -1..+1
  return Math.round(((positiveCount - negativeCount) / total) * 100) / 100;
}

// ─── Finnhub API ────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Fetch company news from Finnhub for the last 7 days.
 * Returns empty array if FINNHUB_API_KEY is not configured.
 */
export async function fetchCompanyNews(symbol: string): Promise<NewsArticle[]> {
  ensureCacheTable();

  const cacheKey = `news:${symbol}`;
  const cached = getCached<NewsArticle[]>(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.warn('[Finnhub] No FINNHUB_API_KEY configured — returning empty news. Get a free key at https://finnhub.io/register');
    return [];
  }

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Finnhub expects the base symbol without exchange suffix
    const baseSymbol = symbol.replace(/\.[A-Z]+$/, '');

    const resp = await axios.get('https://finnhub.io/api/v1/company-news', {
      params: {
        symbol: baseSymbol,
        from: formatDate(weekAgo),
        to: formatDate(now),
        token: apiKey,
      },
      timeout: 10_000,
    });

    if (!Array.isArray(resp.data)) return [];

    const articles: NewsArticle[] = resp.data.slice(0, 20).map((item: any) => {
      const combinedText = `${item.headline || ''} ${item.summary || ''}`;
      return {
        headline: item.headline || '',
        source: item.source || '',
        url: item.url || '',
        datetime: item.datetime
          ? new Date(item.datetime * 1000).toISOString()
          : new Date().toISOString(),
        summary: item.summary || '',
        sentiment: scoreSentiment(combinedText),
      };
    });

    if (articles.length > 0) {
      setCache(cacheKey, articles, NEWS_CACHE_MINUTES);
    }

    return articles;
  } catch (err: any) {
    if (err.response?.status === 429) {
      console.warn(`[Finnhub] Rate limited for ${symbol}`);
    } else {
      console.warn(`[Finnhub] Fetch failed for ${symbol}: ${err.message}`);
    }
    return [];
  }
}

/**
 * Compute aggregate sentiment from news articles.
 * Returns a value between -1 and +1.
 */
export function aggregateNewsSentiment(articles: NewsArticle[]): number {
  if (articles.length === 0) return 0;
  const total = articles.reduce((sum, a) => sum + a.sentiment, 0);
  return Math.round((total / articles.length) * 100) / 100;
}
