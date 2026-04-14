/**
 * Reactive News Monitor — Polls Finnhub for breaking news and triggers immediate
 * analysis + trading on high-impact events.
 */
import axios from 'axios';
import { getDb } from '../db';
import { chatCompletion } from './llm/provider';
import { analyzeStock } from './signals';
import { shouldBuy, shouldSell, executeTrade } from './tradingEngine';
import { logActivity } from './activityLogger';
import type { Stock } from '@apex/shared';
import { fetchStockQuote, fetchHistoricalPrices, fetchFundamentals, fetchExtendedFundamentals } from './marketData';
import { fetchCompanyNews } from './apis/finnhub';
import { fetchSearchTrend } from './apis/googleTrends';
import type { MarketData } from './signals';

// ─── Types ──────────────────────────────────────────────────────

export interface ReactiveEvent {
  id: number;
  impact_level: 'critical' | 'high' | 'medium' | 'low';
  event_summary: string;
  news_headlines: string;  // JSON array of headlines
  buy_candidates: string;  // JSON array of {symbol, reason}
  sell_candidates: string; // JSON array of {symbol, reason}
  portfolio_risk: string;
  trades_executed: number;
  detected_at: string;
  processed_at: string | null;
  duration_ms: number | null;
}

interface LLMNewsAnalysis {
  impact_level: 'critical' | 'high' | 'medium' | 'low';
  event_summary: string;
  buy_candidates: { symbol: string; reason: string }[];
  sell_candidates: { symbol: string; reason: string }[];
  portfolio_risk: string;
}

// ─── Database Setup ─────────────────────────────────────────────

export function ensureReactiveEventsTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactive_events (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      impact_level     TEXT    NOT NULL CHECK (impact_level IN ('critical','high','medium','low')),
      event_summary    TEXT    NOT NULL,
      news_headlines   TEXT    NOT NULL,
      buy_candidates   TEXT    NOT NULL,
      sell_candidates  TEXT    NOT NULL,
      portfolio_risk   TEXT    NOT NULL,
      trades_executed  INTEGER NOT NULL DEFAULT 0,
      detected_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      processed_at     TEXT,
      duration_ms      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_reactive_events_time ON reactive_events(detected_at);
    CREATE INDEX IF NOT EXISTS idx_reactive_events_impact ON reactive_events(impact_level);
  `);
}

// ─── News Fetching ──────────────────────────────────────────────

/**
 * Fetch recent general market news from Finnhub.
 * Uses the /v1/news endpoint with category=general.
 */
async function fetchGeneralMarketNews(): Promise<Array<{
  headline: string;
  source: string;
  datetime: number;
  summary: string;
  url: string;
}>> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    console.warn('[ReactiveNews] No FINNHUB_API_KEY — cannot monitor news');
    return [];
  }

  try {
    const resp = await axios.get('https://finnhub.io/api/v1/news', {
      params: { category: 'general', token: apiKey },
      timeout: 10_000,
    });

    if (!Array.isArray(resp.data)) return [];

    // Return last 30 headlines from past 24 hours
    const dayAgo = Date.now() / 1000 - 24 * 60 * 60;
    return resp.data
      .filter((item: any) => item.datetime >= dayAgo)
      .slice(0, 30)
      .map((item: any) => ({
        headline: item.headline || '',
        source: item.source || '',
        datetime: item.datetime,
        summary: item.summary || '',
        url: item.url || '',
      }));
  } catch (err: any) {
    if (err.response?.status === 429) {
      logActivity('warn', 'system', 'Finnhub rate limited during reactive news check', undefined, undefined, 2);
    } else {
      logActivity('error', 'system', `Reactive news fetch failed: ${err.message}`, undefined, undefined, 2);
    }
    return [];
  }
}

// ─── LLM Analysis ───────────────────────────────────────────────

/**
 * Send recent news headlines to LLM for impact classification.
 */
async function analyzeNewsWithLLM(
  headlines: Array<{ headline: string; source: string; summary: string }>,
  portfolioStocks: Stock[]
): Promise<LLMNewsAnalysis | null> {
  const systemPrompt = `You are a financial news analyst for an autonomous trading system. Your job is to:
1. Assess the IMPACT LEVEL of recent news: CRITICAL (war, sanctions, major policy), HIGH (earnings surprises, major deals), MEDIUM (regulatory changes), LOW (routine news)
2. Identify stocks that would BENEFIT from the news (buy candidates)
3. Identify stocks in the current portfolio at risk of LOSS (sell candidates)
4. Describe overall portfolio risk

Return a JSON object with this EXACT structure:
{
  "impact_level": "critical" | "high" | "medium" | "low",
  "event_summary": "brief description of the news event",
  "buy_candidates": [{"symbol": "XOM", "reason": "Oil prices surge on Iran tensions"}],
  "sell_candidates": [{"symbol": "TSLA", "reason": "EV subsidies cut in proposed budget"}],
  "portfolio_risk": "description of risk to current holdings"
}

Be selective — only suggest trades for HIGH or CRITICAL events. For MEDIUM/LOW, return empty arrays.`;

  const portfolioSymbols = portfolioStocks.map(s => s.symbol).join(', ');
  const newsText = headlines.map(h => `• ${h.headline} (${h.source})`).join('\n');

  const userPrompt = `Recent news headlines (last 24 hours):
${newsText}

Current portfolio holdings: ${portfolioSymbols || 'None'}

Analyze the news and identify high-impact events requiring immediate trading action.`;

  const response = await chatCompletion(systemPrompt, userPrompt, {
    maxTokens: 1000,
    temperature: 0.2,
  });

  if (!response) return null;

  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonText = response.content.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }
    const parsed = JSON.parse(jsonText);

    // Validate structure
    if (!parsed.impact_level || !parsed.event_summary) {
      logActivity('warn', 'llm', 'LLM returned invalid news analysis structure', undefined, { raw: response.content }, 3);
      return null;
    }

    return {
      impact_level: parsed.impact_level,
      event_summary: parsed.event_summary,
      buy_candidates: parsed.buy_candidates || [],
      sell_candidates: parsed.sell_candidates || [],
      portfolio_risk: parsed.portfolio_risk || 'No immediate risk detected',
    };
  } catch (err: any) {
    logActivity('error', 'llm', `Failed to parse LLM news analysis: ${err.message}`, undefined, { raw: response.content }, 3);
    return null;
  }
}

// ─── Targeted Stock Analysis ───────────────────────────────────

/**
 * Build market data for a stock (same as scheduler pipeline).
 */
async function buildMarketData(stock: Stock): Promise<MarketData> {
  const marketData: MarketData = {};

  try {
    // Quote
    const quote = await fetchStockQuote(stock.symbol, stock.market);
    if (quote) {
      marketData.currentPrice = quote.price;
    }

    // Historical prices
    const history = await fetchHistoricalPrices(stock.symbol, '3mo', stock.market);
    if (history.length > 0) {
      marketData.priceHistory = history.map(h => h.close);
      marketData.volumeHistory = history.map(h => h.volume);

      // SMA calculations
      const closes = marketData.priceHistory;
      if (closes.length >= 50) {
        marketData.sma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
      }
      if (closes.length >= 200) {
        marketData.sma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
      }
    }

    // Fundamentals
    const fundamentals = await fetchFundamentals(stock.symbol);
    if (fundamentals) {
      marketData.peRatio = fundamentals.peRatio ?? undefined;
      marketData.pbRatio = fundamentals.pbRatio ?? undefined;
      marketData.dividendYield = fundamentals.dividendYield ?? undefined;
      marketData.eps = fundamentals.eps ?? undefined;
      marketData.marketCap = fundamentals.marketCap ?? undefined;
      marketData.revenueGrowth = fundamentals.revenueGrowth ?? undefined;
      marketData.profitMargin = fundamentals.profitMargin ?? undefined;
    }

    // Extended fundamentals
    const extended = await fetchExtendedFundamentals(stock.symbol);
    if (extended) {
      marketData.forwardPE = extended.forward_pe ?? undefined;
      marketData.pegRatio = extended.peg_ratio ?? undefined;
      marketData.analystTargetPrice = extended.analyst_target_price ?? undefined;
      marketData.beta = extended.beta ?? undefined;
      marketData.bookValue = extended.book_value ?? undefined;
      marketData.evToRevenue = extended.ev_to_revenue ?? undefined;
      marketData.evToEbitda = extended.ev_to_ebitda ?? undefined;
      marketData.quarterlyRevenueGrowthYOY = extended.earnings_quarterly_growth ?? undefined;
      marketData.quarterlyEarningsGrowthYOY = extended.earnings_quarterly_growth ?? undefined;
    }

    // News
    const news = await fetchCompanyNews(stock.symbol);
    if (news.length > 0) {
      marketData.newsArticles = news.map(n => ({
        headline: n.headline,
        source: n.source,
        sentiment: n.sentiment,
        publishedAt: n.datetime,
        summary: n.summary,
      }));
    }

    // Search trends
    const trend = await fetchSearchTrend(stock.symbol);
    if (trend) {
      marketData.searchTrend = trend;
    }
  } catch (err: any) {
    logActivity('warn', 'signal', `Market data collection error: ${err.message}`, stock.symbol, undefined, 4);
  }

  return marketData;
}

/**
 * Run fast analysis on a specific stock and execute trade if warranted.
 */
async function analyzeAndTrade(stock: Stock, reason: string, tradeType: 'buy' | 'sell'): Promise<boolean> {
  try {
    logActivity('info', 'trade', `Reactive analysis triggered: ${reason}`, stock.symbol, undefined, 3);

    // Build market data
    const marketData = await buildMarketData(stock);

    // Run signal analysis
    const analysis = await analyzeStock(stock, marketData);
    if (!analysis) {
      logActivity('warn', 'signal', 'Analysis returned null', stock.symbol, undefined, 3);
      return false;
    }

    logActivity('reasoning', 'signal', 'Reactive analysis complete', stock.symbol, {
      score: analysis.overallScore,
      confidence: analysis.overallConfidence,
      direction: analysis.direction,
    }, 4);

    // Convert AggregateSignalResult to EvaluationResult format for trading engine
    const evaluation = {
      compositeScore: analysis.compositeScore,
      confidence: analysis.overallConfidence,
      recommendation: analysis.recommendation,
      signalBreakdown: Object.fromEntries(
        analysis.weightedBreakdown.map(wb => [wb.source, {
          direction: wb.direction,
          strength: wb.score / 100,
          weighted: wb.weightedScore / 100,
        }])
      ),
      rationale: analysis.rationale,
    };

    // Check if we should trade
    if (tradeType === 'buy') {
      const decision = shouldBuy(stock.symbol, evaluation, marketData.currentPrice || 0);
      if (decision.shouldTrade) {
        await executeTrade({
          stockId: stock.id,
          symbol: stock.symbol,
          action: 'buy',
          quantity: decision.quantity,
          pricePerShare: marketData.currentPrice || 0,
          confidence: evaluation.confidence,
          rationale: `REACTIVE: ${reason}. ${decision.reason}`,
          signalSnapshot: JSON.stringify(analysis.signals),
        });

        logActivity('trade', 'trade', `Reactive BUY executed`, stock.symbol, {
          quantity: decision.quantity,
          price: marketData.currentPrice,
          reason: reason,
        }, 2);

        return true;
      }
    } else if (tradeType === 'sell') {
      const decision = shouldSell(stock.symbol, evaluation, marketData.currentPrice || 0);
      if (decision.shouldTrade) {
        await executeTrade({
          stockId: stock.id,
          symbol: stock.symbol,
          action: 'sell',
          quantity: decision.quantity,
          pricePerShare: marketData.currentPrice || 0,
          confidence: evaluation.confidence,
          rationale: `REACTIVE: ${reason}. ${decision.reason}`,
          signalSnapshot: JSON.stringify(analysis.signals),
        });

        logActivity('trade', 'trade', `Reactive SELL executed`, stock.symbol, {
          quantity: decision.quantity,
          price: marketData.currentPrice,
          reason: reason,
        }, 2);

        return true;
      }
    }

    return false;
  } catch (err: any) {
    logActivity('error', 'trade', `Reactive analysis failed: ${err.message}`, stock.symbol, undefined, 2);
    return false;
  }
}

// ─── Main Monitor Function ──────────────────────────────────────

/**
 * Poll recent news, assess impact, and trigger immediate trades if warranted.
 */
export async function monitorNewsAndReact(): Promise<void> {
  ensureReactiveEventsTable();

  const startTime = Date.now();
  logActivity('info', 'system', 'Starting reactive news monitor', undefined, undefined, 2);

  try {
    // 1. Fetch recent news
    const newsHeadlines = await fetchGeneralMarketNews();
    if (newsHeadlines.length === 0) {
      logActivity('info', 'system', 'No recent news to analyze', undefined, undefined, 3);
      return;
    }

    logActivity('info', 'system', `Fetched ${newsHeadlines.length} recent headlines`, undefined, undefined, 3);

    // 2. Get portfolio stocks
    const db = getDb();
    const portfolioRows = db.prepare(`
      SELECT s.* FROM stocks s
      INNER JOIN portfolio_positions pp ON s.id = pp.stock_id
      WHERE pp.quantity > 0
    `).all() as Stock[];

    // 3. Analyze news with LLM
    const analysis = await analyzeNewsWithLLM(newsHeadlines, portfolioRows);
    if (!analysis) {
      logActivity('warn', 'llm', 'LLM news analysis failed or unavailable', undefined, undefined, 3);
      return;
    }

    logActivity('reasoning', 'llm', `News impact: ${analysis.impact_level.toUpperCase()}`, undefined, {
      summary: analysis.event_summary,
      buy_candidates: analysis.buy_candidates.length,
      sell_candidates: analysis.sell_candidates.length,
    }, 3);

    // Skip if LOW or MEDIUM impact
    if (analysis.impact_level === 'low' || analysis.impact_level === 'medium') {
      logActivity('info', 'system', `Impact level ${analysis.impact_level} — skipping reactive trades`, undefined, undefined, 3);
      return;
    }

    // 4. Record event
    const headlinesJson = JSON.stringify(newsHeadlines.map(h => h.headline));
    const eventId = db.prepare(`
      INSERT INTO reactive_events (
        impact_level, event_summary, news_headlines,
        buy_candidates, sell_candidates, portfolio_risk
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      analysis.impact_level,
      analysis.event_summary,
      headlinesJson,
      JSON.stringify(analysis.buy_candidates),
      JSON.stringify(analysis.sell_candidates),
      analysis.portfolio_risk
    ).lastInsertRowid as number;

    logActivity('discovery', 'system', `Reactive event detected: ${analysis.event_summary}`, undefined, {
      impact: analysis.impact_level,
      event_id: eventId,
    }, 2);

    // 5. Process SELL candidates (portfolio positions at risk)
    let tradesExecuted = 0;
    for (const candidate of analysis.sell_candidates) {
      const stock = portfolioRows.find(s => s.symbol === candidate.symbol);
      if (stock) {
        const traded = await analyzeAndTrade(stock, candidate.reason, 'sell');
        if (traded) tradesExecuted++;
      }
    }

    // 6. Process BUY candidates (stocks that would benefit)
    for (const candidate of analysis.buy_candidates) {
      const stock = db.prepare('SELECT * FROM stocks WHERE symbol = ? AND is_active = 1').get(candidate.symbol) as Stock | undefined;
      if (stock) {
        const traded = await analyzeAndTrade(stock, candidate.reason, 'buy');
        if (traded) tradesExecuted++;
      } else {
        logActivity('info', 'system', `Buy candidate not in stock universe — skipping`, candidate.symbol, undefined, 3);
      }
    }

    // 7. Update event record
    const duration = Date.now() - startTime;
    db.prepare(`
      UPDATE reactive_events
      SET trades_executed = ?, processed_at = datetime('now'), duration_ms = ?
      WHERE id = ?
    `).run(tradesExecuted, duration, eventId);

    logActivity('info', 'system', `Reactive monitor complete: ${tradesExecuted} trades executed`, undefined, { duration_ms: duration }, 2);

  } catch (err: any) {
    logActivity('error', 'system', `Reactive news monitor failed: ${err.message}`, undefined, undefined, 1);
  }
}

// ─── History Retrieval ──────────────────────────────────────────

export function getReactiveEventHistory(limit = 10): ReactiveEvent[] {
  ensureReactiveEventsTable();
  const db = getDb();
  return db.prepare(`
    SELECT * FROM reactive_events
    ORDER BY detected_at DESC
    LIMIT ?
  `).all(limit) as ReactiveEvent[];
}
