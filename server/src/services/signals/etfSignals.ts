import type { Stock } from '../../types';
import type { SignalResult, MarketData } from './index';
import { analyzeMacroRegime } from './macroRegimeSignal';

/**
 * ETF-Specific Signal Analysis
 * 
 * ETFs require fundamentally different analysis than individual stocks:
 * - Macro/geopolitical trends matter more than individual company metrics
 * - Sector composition and rotation drive returns
 * - Broader market sentiment is key
 * - Longer-term trend analysis (weeks/months, not days)
 * - Individual valuation metrics (P/E) less meaningful
 * 
 * Signal weights for ETFs (longer-horizon tuned):
 * - macro_trend: 35% (macro/geopolitical/economic — highest priority)
 * - sector_momentum: 25% (sector performance & rotation)
 * - market_sentiment: 20% (broad market news sentiment)
 * - search_interest: 10% (sustained interest, minimal contrarian penalty)
 * - valuation: 10% (basic valuation + P/B + expense awareness)
 */

// ─── Macro Trend Signal ──────────────────────────────────────────

/**
 * Analyze macro/geopolitical trends from news articles.
 * 
 * Looks for macro themes: interest rates, inflation, trade policy,
 * geopolitical events, economic indicators, sector-specific regulation.
 * 
 * Uses broader keyword analysis vs. company-specific news.
 */
export async function analyzeMacroTrend(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const newsArticles = marketData.newsArticles;

  if (!newsArticles || newsArticles.length === 0) {
    return {
      source: 'macro_trend',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: 'No news data available for macro trend analysis.',
      breakdown: { dataAvailable: false },
    };
  }

  // Keywords indicating macro/geopolitical themes (expanded for ETF sector themes)
  const macroKeywords = {
    bullish: [
      'rate cut', 'stimulus', 'easing', 'recovery', 'growth acceleration',
      'trade deal', 'infrastructure bill', 'tax cut', 'bullish outlook',
      'expansion', 'positive economic', 'strong gdp', 'job growth',
      'energy policy', 'green energy', 'clean energy', 'renewable',
      'central bank dovish', 'quantitative easing', 'housing recovery',
      'consumer confidence', 'manufacturing expansion', 'supply chain improvement',
      'commodity rally', 'emerging market growth', 'fiscal spending',
      'technological adoption', 'ai investment', 'defense spending',
    ],
    bearish: [
      'rate hike', 'inflation', 'recession', 'slowdown', 'contraction',
      'trade war', 'tariff', 'sanctions', 'regulatory crackdown',
      'economic uncertainty', 'downturn', 'weak gdp', 'unemployment',
      'energy crisis', 'central bank hawkish', 'quantitative tightening',
      'housing market decline', 'consumer spending decline', 'debt ceiling',
      'supply chain disruption', 'commodity crash', 'currency crisis',
      'geopolitical conflict', 'pandemic', 'banking crisis', 'credit crunch',
    ],
  };

  const now = Date.now();
  const HALF_LIFE_MS = 18 * 24 * 60 * 60 * 1000; // 18 days — ETF macro trends persist longer than stock news

  let bullishScore = 0;
  let bearishScore = 0;
  let totalWeight = 0;
  let macroRelevantCount = 0;

  for (const article of newsArticles) {
    const headline = article.headline.toLowerCase();
    const summary = (article.summary || '').toLowerCase();
    const text = `${headline} ${summary}`;

    // Check for macro relevance
    let isMacroRelevant = false;
    let localBullish = 0;
    let localBearish = 0;

    for (const keyword of macroKeywords.bullish) {
      if (text.includes(keyword)) {
        isMacroRelevant = true;
        localBullish++;
      }
    }

    for (const keyword of macroKeywords.bearish) {
      if (text.includes(keyword)) {
        isMacroRelevant = true;
        localBearish++;
      }
    }

    if (!isMacroRelevant) continue;

    macroRelevantCount++;

    // Recency weighting (longer half-life for ETFs)
    const ageMs = Math.max(0, now - new Date(article.publishedAt).getTime());
    const recencyWeight = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    const w = Math.max(0.25, recencyWeight); // Higher floor: older macro context still valuable for ETFs

    // Combine keyword analysis with pre-computed sentiment
    const keywordSignal = localBullish - localBearish;
    const combinedSignal = (keywordSignal + article.sentiment * 2) / 3;

    if (combinedSignal > 0) {
      bullishScore += combinedSignal * w;
    } else {
      bearishScore += Math.abs(combinedSignal) * w;
    }

    totalWeight += w;
  }

  // Score based on macro sentiment balance
  let score = 50;
  let confidence = 0.1;

  if (totalWeight > 0) {
    const netSentiment = (bullishScore - bearishScore) / totalWeight;
    // Map sentiment range [-2, +2] to score range [20, 80]
    score = Math.max(20, Math.min(80, 50 + netSentiment * 15));

    // Confidence scales with number of macro-relevant articles
    const coverageScore = Math.min(1, macroRelevantCount / 5);
    confidence = Math.round(Math.min(1, 0.4 + coverageScore * 0.5) * 100) / 100;
  }

  const direction = score >= 60 ? 'bullish' as const
    : score <= 40 ? 'bearish' as const
    : 'neutral' as const;

  return {
    source: 'macro_trend',
    score: Math.round(score),
    confidence,
    direction,
    reasoning: `Analyzed ${macroRelevantCount} macro-relevant articles. ${
      direction === 'bullish'
        ? 'Macro themes are net positive (rate cuts, growth, stimulus).'
        : direction === 'bearish'
          ? 'Macro themes are net negative (rate hikes, recession fears, trade tensions).'
          : 'Macro environment appears mixed or neutral.'
    }`,
    breakdown: {
      macroArticles: macroRelevantCount,
      bullishThemes: Math.round(bullishScore * 100) / 100,
      bearishThemes: Math.round(bearishScore * 100) / 100,
      netSentiment: Math.round(((bullishScore - bearishScore) / Math.max(1, totalWeight)) * 100) / 100,
      dataAvailable: true,
    },
  };
}

// ─── Sector Momentum Signal ──────────────────────────────────────

/**
 * Analyze sector performance and momentum.
 * 
 * For ETFs, the sector matters more than individual company fundamentals.
 * This signal looks at recent price trend vs. longer-term trend to detect
 * sector rotation and momentum shifts.
 * 
 * Future enhancement: compare with sector benchmark indices.
 */
export async function analyzeSectorMomentum(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const prices = marketData.priceHistory || [];
  const currentPrice = marketData.currentPrice;

  if (prices.length < 40 || !currentPrice) {
    return {
      source: 'price_trend',
      score: 50,
      confidence: 0.15,
      direction: 'neutral',
      reasoning: 'Insufficient price history for ETF sector momentum analysis (need 40+ days).',
      breakdown: { dataAvailable: false },
    };
  }

  // ETF-tuned lookback windows: 40-day short, 120-day medium, 200-day long-term
  const shortTermPrices = prices.slice(-40);
  const mediumTermPrices = prices.slice(-120);
  const longTermPrices = prices.slice(-200);

  const shortTermReturn = (currentPrice - shortTermPrices[0]) / shortTermPrices[0];
  const mediumTermReturn = mediumTermPrices.length >= 120
    ? (currentPrice - mediumTermPrices[0]) / mediumTermPrices[0]
    : shortTermReturn;
  const longTermReturn = longTermPrices.length >= 200
    ? (currentPrice - longTermPrices[0]) / longTermPrices[0]
    : mediumTermReturn;

  // Momentum acceleration (short-term vs medium-term)
  const momentumAcceleration = shortTermReturn - mediumTermReturn;

  // Calculate volatility over the short-term window
  const returns = shortTermPrices.map((p, i) =>
    i === 0 ? 0 : (p - shortTermPrices[i - 1]) / shortTermPrices[i - 1]
  );
  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance);

  // Score based on trend and momentum — ETFs weight medium/long-term more
  let score = 50;

  // Base score on medium-term return (primary for ETFs)
  const trendScore = Math.max(-40, Math.min(40, mediumTermReturn * 180));

  // Long-term trend comparison: bonus if 200-day trend is positive
  const longTermBonus = Math.max(-10, Math.min(10, longTermReturn * 50));

  // Momentum adjustment (smaller weight — ETFs should be patient with dips)
  const momentumBonus = Math.max(-8, Math.min(8, momentumAcceleration * 80));

  score = Math.round(50 + trendScore + longTermBonus + momentumBonus);
  score = Math.max(0, Math.min(100, score));

  // Confidence: full confidence at 200 days; reduced volatility penalty for ETFs
  const dataScore = Math.min(1, prices.length / 200);
  const volatilityPenalty = Math.min(0.2, volatility * 6); // Reduced penalty: ETFs tolerate dips better
  const confidence = Math.round(Math.max(0.2, Math.min(0.9, 0.5 + dataScore * 0.3 - volatilityPenalty)) * 100) / 100;

  const direction = score >= 60 ? 'bullish' as const
    : score <= 40 ? 'bearish' as const
    : 'neutral' as const;

  return {
    source: 'price_trend',
    score,
    confidence,
    direction,
    reasoning: `Sector momentum (ETF): ${
      momentumAcceleration > 0.02
        ? 'accelerating upward'
        : momentumAcceleration < -0.02
          ? 'decelerating'
          : 'stable'
    }. 40-day return: ${(shortTermReturn * 100).toFixed(1)}%, 120-day: ${(mediumTermReturn * 100).toFixed(1)}%, 200-day: ${(longTermReturn * 100).toFixed(1)}%.`,
    breakdown: {
      shortTermReturn: Math.round(shortTermReturn * 10000) / 100,
      mediumTermReturn: Math.round(mediumTermReturn * 10000) / 100,
      longTermReturn: Math.round(longTermReturn * 10000) / 100,
      momentumAcceleration: Math.round(momentumAcceleration * 10000) / 100,
      volatility: Math.round(volatility * 10000) / 100,
      dataPoints: prices.length,
      dataAvailable: true,
    },
  };
}

// ─── Market Sentiment Signal ─────────────────────────────────────

/**
 * Analyze broad market sentiment from news.
 * 
 * For ETFs, we care about overall market mood more than company-specific news.
 * This is similar to the stock sentiment signal but interprets news through
 * a broader market lens.
 */
export async function analyzeMarketSentiment(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const newsArticles = marketData.newsArticles;

  if (!newsArticles || newsArticles.length === 0) {
    return {
      source: 'news_sentiment',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: 'No news data available for market sentiment analysis.',
      breakdown: { dataAvailable: false },
    };
  }

  const now = Date.now();
  const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — ETF sentiment is stickier than stock sentiment

  let weightedSum = 0;
  let totalWeight = 0;

  for (const article of newsArticles) {
    const ageMs = Math.max(0, now - new Date(article.publishedAt).getTime());
    const recencyWeight = Math.pow(0.5, ageMs / HALF_LIFE_MS);
    const w = Math.max(0.20, recencyWeight); // Higher floor for ETF sentiment longevity
    
    weightedSum += article.sentiment * w;
    totalWeight += w;
  }

  // Consensus bonus: broader agreement matters more for ETFs
  let consensusBoost = 0;
  {
    let positive = 0;
    let negative = 0;
    for (const a of newsArticles) {
      if (a.sentiment > 0.1) positive++;
      else if (a.sentiment < -0.1) negative++;
    }
    const dominant = Math.max(positive, negative);
    const consensusRatio = newsArticles.length > 1 ? dominant / newsArticles.length : 0.5;
    // Strong consensus amplifies the signal direction for ETFs
    if (consensusRatio > 0.7) {
      const avgSentimentDir = totalWeight > 0 ? weightedSum / totalWeight : 0;
      consensusBoost = avgSentimentDir * (consensusRatio - 0.5) * 15;
    }
  }

  const avgSentiment = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Measure consensus (reuse from boost calculation)
  let positive = 0;
  let negative = 0;
  for (const a of newsArticles) {
    if (a.sentiment > 0.1) positive++;
    else if (a.sentiment < -0.1) negative++;
  }
  const dominant = Math.max(positive, negative);
  const consensusRatio = newsArticles.length > 1 ? dominant / newsArticles.length : 0.5;

  // Map sentiment [-1, +1] to score [0, 100], then apply consensus boost
  let score = Math.round(50 + avgSentiment * 40 + consensusBoost);
  score = Math.max(0, Math.min(100, score));

  // Confidence: scales with article count and consensus
  const volumeScore = Math.min(1, newsArticles.length / 10);
  const confidence = Math.round(Math.max(0.15, Math.min(0.85, (0.3 + volumeScore * 0.3 + consensusRatio * 0.25))) * 100) / 100;

  const direction = score >= 60 ? 'bullish' as const
    : score <= 40 ? 'bearish' as const
    : 'neutral' as const;

  return {
    source: 'news_sentiment',
    score,
    confidence,
    direction,
    reasoning: `Market sentiment from ${newsArticles.length} articles is ${
      avgSentiment > 0.2 ? 'positive' : avgSentiment < -0.2 ? 'negative' : 'neutral'
    } (avg: ${avgSentiment.toFixed(2)}). Consensus: ${(consensusRatio * 100).toFixed(0)}%.`,
    breakdown: {
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      articleCount: newsArticles.length,
      positiveCount: positive,
      negativeCount: negative,
      consensusRatio: Math.round(consensusRatio * 100) / 100,
      dataAvailable: true,
    },
  };
}

// ─── Search Interest Signal (adapted for ETFs) ───────────────────

/**
 * Analyze longer-term search interest patterns.
 * 
 * For ETFs, we care about sustained interest over time rather than
 * short-term spikes. High sustained interest = retail awareness.
 */
export async function analyzeSearchInterestETF(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const searchTrend = marketData.searchTrend;

  if (!searchTrend) {
    return {
      source: 'google_trends',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: 'No search trend data available for ETF.',
      breakdown: { dataAvailable: false },
    };
  }

  const { trend, changePercent, currentInterest, previousInterest } = searchTrend;

  let score: number;
  let confidence: number;

  // For ETFs, sustained high interest is a positive signal, not contrarian
  if (trend === 'rising') {
    const magnitudeBonus = Math.min(25, Math.abs(changePercent) * 0.5);
    score = 58 + magnitudeBonus; // Higher base: rising interest is bullish for ETFs

    // Minimal contrarian penalty — sustained ETF interest is normal
    if (currentInterest > 90) {
      score -= 3; // Almost no penalty
    }
  } else if (trend === 'falling') {
    const magnitudePenalty = Math.min(25, Math.abs(changePercent) * 0.5);
    score = 45 - magnitudePenalty;
  } else {
    // Stable: sustained high interest is a positive for ETFs
    score = 50 + Math.min(15, currentInterest / 6);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Confidence based on trend clarity
  const trendStrength = Math.min(1, Math.abs(changePercent) / 40);
  const baseConfidence = trend === 'stable' ? 0.35 : 0.5;
  confidence = Math.round(Math.min(1, baseConfidence + trendStrength * 0.35) * 100) / 100;

  const direction = score >= 60 ? 'bullish' as const
    : score <= 40 ? 'bearish' as const
    : 'neutral' as const;

  return {
    source: 'google_trends',
    score,
    confidence,
    direction,
    reasoning: `Search interest ${trend} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%). Sustained interest at ${currentInterest}/100 reflects retail awareness.`,
    breakdown: {
      currentInterest,
      previousInterest,
      trend,
      changePercent,
      sustainedInterest: currentInterest > 50,
      dataAvailable: true,
    },
  };
}

// ─── Valuation Signal (adapted for ETFs) ─────────────────────────

/**
 * Basic valuation signal for ETFs.
 * 
 * ETF P/E is less meaningful than for stocks, but can still indicate
 * relative value. Lower weight in overall scoring.
 */
export async function analyzeValuationETF(
  stock: Stock,
  marketData: MarketData,
): Promise<SignalResult> {
  const { peRatio, pbRatio, dividendYield } = marketData;

  // For ETFs, evaluate P/E, P/B, and dividend yield
  const metrics: Array<{ name: string; score: number; weight: number }> = [];

  // P/E scoring (relative to market average of 20)
  if (peRatio != null && peRatio > 0) {
    const marketAvgPE = 20;
    const deviation = (marketAvgPE - peRatio) / marketAvgPE;
    const peScore = Math.max(0, Math.min(100, 50 + deviation * 80));
    metrics.push({ name: 'P/E', score: peScore, weight: 0.35 });
  }

  // P/B ratio scoring (relative to market average of ~3)
  if (pbRatio != null && pbRatio > 0) {
    const marketAvgPB = 3;
    const deviation = (marketAvgPB - pbRatio) / marketAvgPB;
    const pbScore = Math.max(0, Math.min(100, 50 + deviation * 60));
    metrics.push({ name: 'P/B', score: pbScore, weight: 0.25 });
  }

  // Dividend yield scoring (higher yield = more attractive)
  if (dividendYield != null && dividendYield > 0) {
    const yieldScore = Math.min(100, 40 + dividendYield * 2000); // 3% yield → 100
    metrics.push({ name: 'Yield', score: yieldScore, weight: 0.40 });
  }

  if (metrics.length === 0) {
    return {
      source: 'pe_ratio',
      score: 50,
      confidence: 0.1,
      direction: 'neutral',
      reasoning: 'No valuation data available for ETF.',
      breakdown: { dataAvailable: false },
    };
  }

  // Weighted average
  const totalWeight = metrics.reduce((s, m) => s + m.weight, 0);
  const score = Math.round(
    metrics.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight
  );

  // Confidence based on data availability
  const confidence = Math.round(Math.min(0.7, 0.3 + metrics.length * 0.2) * 100) / 100;

  const direction = score >= 60 ? 'bullish' as const
    : score <= 40 ? 'bearish' as const
    : 'neutral' as const;

  return {
    source: 'pe_ratio',
    score,
    confidence,
    direction,
    reasoning: `ETF valuation: ${
      peRatio ? `P/E ${peRatio.toFixed(1)}` : ''
    }${peRatio && pbRatio ? ', ' : ''}${
      pbRatio ? `P/B ${pbRatio.toFixed(2)}` : ''
    }${(peRatio || pbRatio) && dividendYield ? ', ' : ''}${
      dividendYield ? `Yield ${(dividendYield * 100).toFixed(2)}%` : ''
    }. ${direction === 'bullish' ? 'Attractive valuation.' : direction === 'bearish' ? 'Rich valuation.' : 'Fair valuation.'}`,
    breakdown: {
      peRatio: peRatio ?? null,
      pbRatio: pbRatio ?? null,
      dividendYield: dividendYield ?? null,
      metricsCount: metrics.length,
      dataAvailable: true,
    },
  };
}

// ─── ETF Signal Pipeline Configuration ──────────────────────────

export interface ETFSignalWeightConfig {
  source: 'macro_trend' | 'price_trend' | 'news_sentiment' | 'google_trends' | 'pe_ratio';
  weight: number;
  analyzer: (stock: Stock, marketData: MarketData) => Promise<SignalResult>;
}

export const ETF_SIGNAL_PIPELINE: ETFSignalWeightConfig[] = [
  { source: 'macro_trend',    weight: 0.35, analyzer: analyzeMacroRegime },      // FRED-based macro regime (upgraded)
  { source: 'price_trend',    weight: 0.25, analyzer: analyzeSectorMomentum },
  { source: 'news_sentiment', weight: 0.20, analyzer: analyzeMarketSentiment },
  { source: 'google_trends',  weight: 0.10, analyzer: analyzeSearchInterestETF },
  { source: 'pe_ratio',       weight: 0.10, analyzer: analyzeValuationETF },
];
