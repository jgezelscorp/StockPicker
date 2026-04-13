import cron from 'node-cron';
import { getDb } from '../db';
import { DEFAULT_SCHEDULER_CONFIG, DEFAULT_SIGNAL_WEIGHTS, type SchedulerConfig, type PipelineRunResult } from '../types';
import { fetchStockQuote, fetchHistoricalPrices, fetchFundamentals, refreshPositionPrices, purgeExpiredCache } from './marketData';
import {
  evaluateSignals,
  shouldBuy,
  shouldSell,
  executeTrade,
  recordAnalysis,
  type SignalInput,
} from './tradingEngine';
import { takeSnapshot as takePortfolioSnapshotFromTracker } from './portfolioTracker';
import { analyzeStock, type MarketData } from './signals';
import { evaluatePastDecisions, adjustWeights, getCurrentWeights } from './learningEngine';
import { fetchCompanyNews } from './apis/finnhub';
import { fetchSearchTrend } from './apis/googleTrends';
import { seedInitialUniverse, discoverNewStocks, pruneInactiveStocks } from './stockDiscovery';
import { analyzeWithReasoning, buildEnhancedRationale } from './llm';

let activeTasks: cron.ScheduledTask[] = [];

// ─── Signal Generation from Market Data ─────────────────────────

/**
 * Generate trading signals from real market data for a stock.
 * Uses price trends, volume, and technical indicators derived from Yahoo Finance data.
 */
async function collectSignals(symbol: string, market: string): Promise<SignalInput[]> {
  const signals: SignalInput[] = [];

  try {
    // 1) Price Trend — from historical data
    const history = await fetchHistoricalPrices(symbol, '3mo', market);
    if (history.length >= 20) {
      const closes = history.map(h => h.close);
      const recent = closes.slice(-5);
      const sma20 = closes.slice(-20).reduce((s, c) => s + c, 0) / 20;
      const sma50 = closes.length >= 50
        ? closes.slice(-50).reduce((s, c) => s + c, 0) / 50
        : sma20;
      const currentPrice = closes[closes.length - 1];

      // Momentum: is price above moving averages?
      const aboveSma20 = currentPrice > sma20;
      const aboveSma50 = currentPrice > sma50;
      const recentTrend = recent[recent.length - 1] > recent[0]; // last 5 days trending up?

      let trendDirection: SignalInput['direction'] = 'neutral';
      let trendStrength = 0.5;

      if (aboveSma20 && aboveSma50 && recentTrend) {
        trendDirection = 'bullish';
        trendStrength = Math.min(1, 0.6 + Math.abs(currentPrice - sma20) / sma20);
      } else if (!aboveSma20 && !aboveSma50 && !recentTrend) {
        trendDirection = 'bearish';
        trendStrength = Math.min(1, 0.6 + Math.abs(sma20 - currentPrice) / sma20);
      } else if (aboveSma20) {
        trendDirection = 'bullish';
        trendStrength = 0.55;
      } else if (!aboveSma20) {
        trendDirection = 'bearish';
        trendStrength = 0.55;
      }

      signals.push({
        source: 'price_trend',
        direction: trendDirection,
        strength: Number(Math.min(1, trendStrength).toFixed(3)),
        value: currentPrice,
        metadata: JSON.stringify({
          sma20: sma20.toFixed(2),
          sma50: sma50.toFixed(2),
          aboveSma20,
          aboveSma50,
          recentTrend,
        }),
      });

      // 2) Volume analysis as macro trend proxy
      const volumes = history.map(h => h.volume);
      const avgVolume = volumes.slice(-20).reduce((s, v) => s + v, 0) / 20;
      const recentVolume = volumes.slice(-3).reduce((s, v) => s + v, 0) / 3;
      const volumeRatio = avgVolume > 0 ? recentVolume / avgVolume : 1;

      // High volume on up days is bullish; high volume on down days is bearish
      const priceChange = currentPrice - closes[closes.length - 6];
      let macroDirection: SignalInput['direction'] = 'neutral';
      let macroStrength = 0.5;

      if (volumeRatio > 1.3 && priceChange > 0) {
        macroDirection = 'bullish';
        macroStrength = Math.min(1, 0.5 + (volumeRatio - 1) * 0.3);
      } else if (volumeRatio > 1.3 && priceChange < 0) {
        macroDirection = 'bearish';
        macroStrength = Math.min(1, 0.5 + (volumeRatio - 1) * 0.3);
      }

      signals.push({
        source: 'macro_trend',
        direction: macroDirection,
        strength: Number(macroStrength.toFixed(3)),
        value: volumeRatio,
        metadata: JSON.stringify({ avgVolume, recentVolume, volumeRatio: volumeRatio.toFixed(2) }),
      });

      // 3) RSI-like momentum as PE ratio proxy (uses price momentum as valuation signal)
      const changes = closes.slice(-15).map((c, i, a) => i > 0 ? c - a[i - 1] : 0).slice(1);
      const gains = changes.filter(c => c > 0);
      const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
      const avgGain = gains.length > 0 ? gains.reduce((s, g) => s + g, 0) / 14 : 0;
      const avgLossVal = losses.length > 0 ? losses.reduce((s, l) => s + l, 0) / 14 : 0;
      const rs = avgLossVal > 0 ? avgGain / avgLossVal : 100;
      const rsi = 100 - (100 / (1 + rs));

      let peDirection: SignalInput['direction'] = 'neutral';
      let peStrength = 0.5;

      if (rsi < 30) {
        peDirection = 'bullish'; // oversold = potentially undervalued
        peStrength = Math.min(1, 0.6 + (30 - rsi) / 100);
      } else if (rsi > 70) {
        peDirection = 'bearish'; // overbought = potentially overvalued
        peStrength = Math.min(1, 0.6 + (rsi - 70) / 100);
      }

      signals.push({
        source: 'pe_ratio',
        direction: peDirection,
        strength: Number(peStrength.toFixed(3)),
        value: Number(rsi.toFixed(2)),
        metadata: JSON.stringify({ rsi: rsi.toFixed(2), avgGain: avgGain.toFixed(4), avgLoss: avgLossVal.toFixed(4) }),
      });
    }

    // 4) Quote-based signals (price change as sentiment proxies)
    const quote = await fetchStockQuote(symbol, market);
    if (quote) {
      // Use daily change as a lightweight sentiment/news proxy
      const dailyChangePct = quote.changePct;

      // Social sentiment proxy: strong moves suggest social buzz
      let socialDir: SignalInput['direction'] = 'neutral';
      let socialStr = 0.4;
      if (dailyChangePct > 2) {
        socialDir = 'bullish';
        socialStr = Math.min(1, 0.5 + dailyChangePct / 20);
      } else if (dailyChangePct < -2) {
        socialDir = 'bearish';
        socialStr = Math.min(1, 0.5 + Math.abs(dailyChangePct) / 20);
      }

      signals.push({
        source: 'social_sentiment',
        direction: socialDir,
        strength: Number(socialStr.toFixed(3)),
        value: dailyChangePct,
        metadata: JSON.stringify({ dailyChange: dailyChangePct.toFixed(2), volume: quote.volume }),
      });

      // News sentiment proxy: based on multi-day momentum
      let newsDir: SignalInput['direction'] = 'neutral';
      let newsStr = 0.5;
      if (dailyChangePct > 1) {
        newsDir = 'bullish';
        newsStr = Math.min(1, 0.5 + dailyChangePct / 15);
      } else if (dailyChangePct < -1) {
        newsDir = 'bearish';
        newsStr = Math.min(1, 0.5 + Math.abs(dailyChangePct) / 15);
      }

      signals.push({
        source: 'news_sentiment',
        direction: newsDir,
        strength: Number(newsStr.toFixed(3)),
        value: dailyChangePct,
        metadata: JSON.stringify({ price: quote.price, change: quote.change }),
      });

      // Google trends proxy: volume spike = attention
      const googleDir: SignalInput['direction'] = dailyChangePct > 0 ? 'bullish' : dailyChangePct < 0 ? 'bearish' : 'neutral';
      signals.push({
        source: 'google_trends',
        direction: googleDir,
        strength: 0.4, // low confidence — this is a rough proxy
        value: null,
        metadata: JSON.stringify({ note: 'Derived from price action; real Google Trends API integration planned' }),
      });
    }
  } catch (err: any) {
    console.error(`[Scheduler] Signal collection failed for ${symbol}:`, err.message);
  }

  return signals;
}

/**
 * Run the main analysis pipeline:
 *  1. Fetch signals for all active stocks
 *  2. Score each stock with composite analysis
 *  3. Execute trades where confidence exceeds threshold
 */
async function runAnalysisPipeline(config: SchedulerConfig): Promise<PipelineRunResult> {
  const start = Date.now();
  const result: PipelineRunResult = {
    stocksAnalysed: 0,
    signalsCaptured: 0,
    tradesExecuted: 0,
    errors: [],
    durationMs: 0,
  };

  try {
    const db = getDb();

    // Get all active stocks
    const stocks = db.prepare('SELECT * FROM stocks WHERE is_active = 1').all() as any[];
    result.stocksAnalysed = stocks.length;

    if (stocks.length === 0) {
      console.log('[Scheduler] No active stocks to analyse');
      result.durationMs = Date.now() - start;
      return result;
    }

    console.log(`[Scheduler] Analysing ${stocks.length} stocks...`);

    for (const stock of stocks) {
      try {
        // 1) Fetch market data for the signal pipeline
        const history = await fetchHistoricalPrices(stock.symbol, '3mo', stock.market);
        const quote = await fetchStockQuote(stock.symbol, stock.market);

        // 2) Fetch real fundamentals, news, and search trends (each wrapped in try/catch)
        let fundamentals: Awaited<ReturnType<typeof fetchFundamentals>> | null = null;
        try {
          fundamentals = await fetchFundamentals(stock.symbol);
        } catch (err: any) {
          console.warn(`[Scheduler] Fundamentals fetch failed for ${stock.symbol}: ${err.message}`);
        }

        let newsArticles: Awaited<ReturnType<typeof fetchCompanyNews>> = [];
        try {
          newsArticles = await fetchCompanyNews(stock.symbol);
        } catch (err: any) {
          console.warn(`[Scheduler] News fetch failed for ${stock.symbol}: ${err.message}`);
        }

        let searchTrend: Awaited<ReturnType<typeof fetchSearchTrend>> | null = null;
        try {
          searchTrend = await fetchSearchTrend(stock.symbol, stock.name);
        } catch (err: any) {
          console.warn(`[Scheduler] Search trend fetch failed for ${stock.symbol}: ${err.message}`);
        }

        // Build MarketData for the signal analysers — now with real data
        const closes = history.map(h => h.close);
        const volumes = history.map(h => h.volume);
        const marketData: MarketData = {
          currentPrice: quote?.price ?? (closes.length > 0 ? closes[closes.length - 1] : undefined),
          priceHistory: closes,
          volumeHistory: volumes,
          sma50: closes.length >= 50
            ? closes.slice(-50).reduce((s, c) => s + c, 0) / 50
            : undefined,
          sma200: closes.length >= 200
            ? closes.slice(-200).reduce((s, c) => s + c, 0) / 200
            : undefined,
          // Real fundamentals from Yahoo Finance quoteSummary
          peRatio: fundamentals?.peRatio ?? undefined,
          pbRatio: fundamentals?.pbRatio ?? undefined,
          dividendYield: fundamentals?.dividendYield ?? undefined,
          eps: fundamentals?.eps ?? undefined,
          marketCap: fundamentals?.marketCap ?? undefined,
          week52High: fundamentals?.week52High ?? undefined,
          week52Low: fundamentals?.week52Low ?? undefined,
          revenueGrowth: fundamentals?.revenueGrowth ?? undefined,
          profitMargin: fundamentals?.profitMargin ?? undefined,
          // Real news articles for sentiment signal
          newsArticles: newsArticles.map(a => ({
            headline: a.headline,
            source: a.source,
            sentiment: a.sentiment,
            publishedAt: a.datetime,
            summary: a.summary || undefined,
          })),
          // Real search trend data
          searchTrend: searchTrend ? {
            currentInterest: searchTrend.currentInterest,
            previousInterest: searchTrend.previousInterest,
            trend: searchTrend.trend,
            changePercent: searchTrend.changePercent,
          } : undefined,
        };

        // 2) Run the structured signal pipeline (valuation, trend, sentiment, search)
        const currentWeights = getCurrentWeights();
        const weightEntries = Object.entries(currentWeights)
          .filter(([, w]) => w > 0)
          .map(([source, weight]) => ({
            source: source as import('../types').SignalSource,
            weight,
          }));

        const aggregate = await analyzeStock(stock, marketData, weightEntries);
        result.signalsCaptured += aggregate.signals.length;

        // 2b) Run LLM qualitative reasoning (gracefully skipped if no LLM configured)
        const reasoning = await analyzeWithReasoning(
          stock.symbol, stock.name || stock.symbol, stock.market,
          aggregate, marketData,
        );

        // Persist individual signals from the pipeline
        const insertSignal = db.prepare(`
          INSERT INTO signals (stock_id, source, direction, strength, value, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const sig of aggregate.signals) {
          insertSignal.run(
            stock.id, sig.source, sig.direction,
            sig.confidence, sig.score, JSON.stringify(sig.breakdown)
          );
        }

        // Build enhanced rationale combining quantitative + qualitative analysis
        const enhancedRationale = buildEnhancedRationale(aggregate.rationale, reasoning);

        // Record analysis log
        db.prepare(`
          INSERT INTO analysis_logs
            (stock_id, composite_score, confidence_level, signal_breakdown, recommendation, rationale)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          stock.id,
          aggregate.compositeScore,
          aggregate.overallConfidence,
          JSON.stringify({
            ...Object.fromEntries(aggregate.weightedBreakdown.map(wb => [wb.source, wb])),
            llm: { verdict: reasoning.llmVerdict, conviction: reasoning.llmConviction, used: reasoning.llmUsed },
          }),
          aggregate.recommendation,
          enhancedRationale
        );

        // 3) Get current price for trading decisions
        if (!quote || quote.price <= 0) continue;

        // Map the aggregate result to the trading engine's evaluation format
        const evaluation = {
          compositeScore: aggregate.compositeScore,
          confidence: aggregate.overallConfidence,
          recommendation: aggregate.recommendation,
          signalBreakdown: Object.fromEntries(
            aggregate.weightedBreakdown.map(wb => [wb.source, {
              direction: wb.direction,
              strength: wb.score / 100,
              weighted: wb.weightedScore / 100,
            }])
          ),
          rationale: enhancedRationale,
        };

        // 4) Check if we should buy or sell
        const buyDecision = shouldBuy(stock.symbol, evaluation, quote.price);
        if (buyDecision.shouldTrade) {
          executeTrade({
            stockId: stock.id,
            symbol: stock.symbol,
            action: 'buy',
            quantity: buyDecision.quantity,
            pricePerShare: quote.price,
            confidence: evaluation.confidence,
            rationale: buildEnhancedRationale(`${evaluation.rationale} | ${buyDecision.reason}`, reasoning),
            signalSnapshot: JSON.stringify(aggregate.weightedBreakdown),
          });
          result.tradesExecuted++;
        }

        const sellDecision = shouldSell(stock.symbol, evaluation, quote.price);
        if (sellDecision.shouldTrade) {
          executeTrade({
            stockId: stock.id,
            symbol: stock.symbol,
            action: 'sell',
            quantity: sellDecision.quantity,
            pricePerShare: quote.price,
            confidence: evaluation.confidence,
            rationale: buildEnhancedRationale(`${evaluation.rationale} | ${sellDecision.reason}`, reasoning),
            signalSnapshot: JSON.stringify(aggregate.weightedBreakdown),
          });
          result.tradesExecuted++;
        }

        const llmTag = reasoning.llmUsed ? ` [LLM: ${reasoning.llmVerdict}]` : '';
        console.log(
          `[Scheduler] ${stock.symbol}: score=${aggregate.compositeScore.toFixed(3)}, ` +
          `confidence=${(aggregate.overallConfidence * 100).toFixed(1)}%, rec=${aggregate.recommendation}${llmTag}`
        );
      } catch (err: any) {
        result.errors.push(`${stock.symbol}: ${err.message}`);
        console.error(`[Scheduler] Error processing ${stock.symbol}:`, err.message);
      }
    }

    // Refresh position prices after analysis
    await refreshPositionPrices();

    // Clean up expired cache entries
    purgeExpiredCache();

    // Record the run timestamp
    db.prepare(`
      INSERT OR REPLACE INTO system_state (key, value, updated_at)
      VALUES ('last_analysis_run', datetime('now'), datetime('now'))
    `).run();

    console.log(
      `[Scheduler] Pipeline complete: ${result.stocksAnalysed} analysed, ` +
      `${result.signalsCaptured} signals, ${result.tradesExecuted} trades`
    );
  } catch (err: any) {
    result.errors.push(err.message || String(err));
    console.error('[Scheduler] Pipeline error:', err);
  }

  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Take a daily snapshot of portfolio value for historical tracking.
 * Delegates to portfolioTracker.takeSnapshot().
 */
function takePortfolioSnapshot(): void {
  try {
    takePortfolioSnapshotFromTracker();
  } catch (err) {
    console.error('[Scheduler] Snapshot error:', err);
  }
}

/**
 * Evaluate closed trades and record learning outcomes.
 * Uses the dedicated learning engine for evaluation and weight adjustment.
 */
function runLearningEvaluation(): void {
  try {
    // Evaluate past decisions and record outcomes
    const outcomes = evaluatePastDecisions();
    console.log(`[Scheduler] Learning engine evaluated ${outcomes.length} past decisions`);

    // Adjust signal weights based on outcomes
    const adjustments = adjustWeights(outcomes);
    if (adjustments.length > 0) {
      console.log(`[Scheduler] Adjusted ${adjustments.length} signal weights:`);
      for (const adj of adjustments) {
        console.log(`  ${adj.source}: ${(adj.oldWeight * 100).toFixed(1)}% → ${(adj.newWeight * 100).toFixed(1)}% (${adj.reason})`);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Learning evaluation error:', err);
  }
}

/**
 * Start all scheduled tasks.
 */
export function startScheduler(config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG): void {
  stopScheduler(); // clear any existing tasks

  console.log('[Scheduler] Starting autonomous pipeline...');
  console.log(`  Analysis:  ${config.analysisCron}`);
  console.log(`  Snapshots: ${config.snapshotCron}`);
  console.log(`  Learning:  ${config.learningCron}`);
  console.log(`  Discovery: weekly (Sundays at 6 AM)`);

  // Main analysis pipeline
  const analysisTask = cron.schedule(config.analysisCron, () => {
    console.log('[Scheduler] Triggering analysis pipeline...');
    runAnalysisPipeline(config).catch(console.error);
  });

  // Daily portfolio snapshot
  const snapshotTask = cron.schedule(config.snapshotCron, () => {
    console.log('[Scheduler] Taking portfolio snapshot...');
    takePortfolioSnapshot();
  });

  // Weekly learning evaluation
  const learningTask = cron.schedule(config.learningCron, () => {
    console.log('[Scheduler] Running learning evaluation...');
    runLearningEvaluation();
  });

  // Weekly stock discovery — Sundays at 6 AM
  const discoveryTask = cron.schedule('0 6 * * 0', () => {
    console.log('[Scheduler] Running stock discovery...');
    runStockDiscovery().catch(console.error);
  });

  activeTasks = [analysisTask, snapshotTask, learningTask, discoveryTask];

  // Take an initial snapshot on startup
  takePortfolioSnapshot();
  console.log('[Scheduler] All tasks scheduled');
}

export function stopScheduler(): void {
  activeTasks.forEach(task => task.stop());
  activeTasks = [];
}

/** Expose for manual trigger via API */
export { runAnalysisPipeline, takePortfolioSnapshot, runLearningEvaluation };

/**
 * Run stock discovery: find new stocks and prune inactive ones.
 */
async function runStockDiscovery(): Promise<{ discovered: number; pruned: number }> {
  const discovered = await discoverNewStocks();
  const pruned = pruneInactiveStocks();
  return { discovered, pruned };
}

export { runStockDiscovery, seedInitialUniverse };
