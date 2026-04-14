# Malcolm — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: Node.js data processing
- User: Jan G.
- Data scope: Market data APIs, valuation metrics, trend detection, sentiment analysis, news signals, confidence scoring, learning system

## Learnings

- Signal pipeline uses 4 analysers (Valuation, Trend, Sentiment, Search Interest) with weights 35/25/20/20 per task spec. Grant's ADR had 6 sources with different weights — I consolidated news + social into one Sentiment signal and deferred Macro until we have real data sources.
- Each signal returns a 0–100 score (internally), mapped to the existing -1..+1 compositeScore for DB storage via `(score - 50) / 50`.
- Learning engine requires 5+ evaluated trades before adjusting weights — conservative ±2% max per cycle to avoid overcorrection.
- Mock data uses deterministic hashing of stock symbols so results are consistent across runs but vary per ticker — makes testing predictable.
- Added `composite: true` to shared/tsconfig.json to fix project reference build chain (was missing from Grant's initial setup).
- Extended shared/src/types.ts with SignalResultDTO, AggregateAnalysisDTO, DecisionAccuracyDTO, LearningReportDTO for frontend consumption.

### 2026-04-13 — Full System Integration
- **Backend Wiring:** Muldoon integrated all 4 signal analysers into `scheduler.ts` pipeline. Market data → signal analysers → aggregator → trading engine → learning feedback loop all working.
- **API Endpoint Validation:** All DTO types now consumed by Muldoon's REST endpoints. Ellie's frontend hooks wrap these endpoints with 30-second refresh.
- **Test Coverage:** Wu's 19 signal tests validate all aggregation logic, scoring ranges (0–100 internal, -1..+1 DB), and weight adjustment bounds (5%–50% per signal).
- **Learning Ready:** 15 Wu tests validate learning engine contracts. Conservative tuning (±2% max, 5-trade minimum) verified. System ready for real trade data to calibrate.

### 2026-04-14 — Real Signal Data Migration
- **MarketData interface expanded:** Added `eps`, `marketCap`, `week52High`, `week52Low`, `revenueGrowth`, `profitMargin`, `newsArticles[]`, and `searchTrend` fields. All optional for backward compat.
- **Valuation signal rewritten:** Consumes real P/E, P/B, div yield from Yahoo Fundamentals. Added market-cap-tier P/E adjustment (mega-caps trade at premium). Added 52-week position scoring (near 52w low with good fundamentals = value opportunity). Added revenue growth + profit margin signals. Confidence scales with data availability: 3 core metrics = 0.85, 2 = 0.65, 1 = 0.45, none = 0.1 neutral. Sector defaults kept as fallback, but real data drives scoring.
- **Sentiment signal rewritten:** Removed all mock/stub functions. Now consumes `marketData.newsArticles` from Finnhub. Recency-weighted sentiment averaging (24-hour half-life). Consensus measurement amplifies signal when articles agree. Social buzz derived as proxy from news volume/intensity (noted for future real social API plug-in). Graceful degradation: no articles → neutral/0.1.
- **Search interest signal rewritten:** Removed all mock/stub functions. Consumes `marketData.searchTrend` from Google Trends. Added contrarian element: very high interest (>80) dampens bullish score. Peak attention + falling = extra bearish. Magnitude-scaled scoring (±0.6 per percent change, capped ±30).
- **Trend signal minor fix:** Improved partial-data handling — when 50–199 days of history available, SMA50 still produces meaningful momentum signal instead of defaulting to neutral.
- All signals handle missing data gracefully: score 50, confidence 0.1, direction neutral. Never throw.

### 2026-04-14 — ETF-Specific Signal Analysis
- **Created `server/src/services/signals/etfSignals.ts`:** New module with ETF-specific analysis using fundamentally different weights and logic vs stocks.
- **ETF signal weights:** macro_trend 30%, sector_momentum 25%, market_sentiment 20%, search_interest 15%, valuation 10% — reflects longer-term macro focus vs individual company metrics.
- **Macro trend signal:** Analyzes news for macro themes (interest rates, inflation, trade policy, geopolitical events) using keyword analysis + Finnhub sentiment. Longer 7-day half-life vs 24hr for stocks. Produces 0-100 score based on macro sentiment balance.
- **Sector momentum signal:** Uses price trend analysis (20-day vs 60-day returns) to detect sector rotation and momentum acceleration. Higher confidence with more data and lower volatility. Future enhancement: compare with sector benchmark indices.
- **Market sentiment signal:** Broader market mood from news (3-day half-life vs 24hr for stocks). Measures consensus across articles. Less focused on company-specific events.
- **Search interest signal (ETF-adapted):** Favors sustained interest over short-term spikes. Less contrarian penalty than stocks — sustained high interest is normal for popular ETFs.
- **Valuation signal (ETF-adapted):** Lower weight (10% vs 35% for stocks). P/E less meaningful for ETFs. Focus on P/E vs market avg and dividend yield. Confidence capped at 0.7 vs 0.85 for stocks.
- **Updated `server/src/services/signals/index.ts`:** Added `analyzeETF()` and `analyzeAsset()` dispatcher. Routes to ETF or stock analyzer based on `asset_type`. All use same `SignalResult` and `AggregateSignalResult` interfaces for consistency.
- **Updated `server/src/services/llm/reasoningEngine.ts`:** Added ETF-specific system prompt (`SYSTEM_PROMPT_ETF`) emphasizing macro outlook, geopolitical risks, sector rotation, longer investment horizon (weeks/months), and ETF composition considerations. Stock prompt kept as `SYSTEM_PROMPT_STOCK`. `analyzeWithReasoning()` now accepts `assetType` parameter and routes to appropriate prompt.
- **Updated `server/src/services/scheduler.ts`:** Integrated `analyzeAsset()` dispatcher — automatically routes ETFs to ETF analyzer, stocks to stock analyzer. Removed old stub code. LLM reasoning already passing `assetType`.
- **All tests pass:** 82 tests including signal aggregation, trading engine, and API endpoints. Build succeeds with no TypeScript errors.

### 2026-04-15 — Trading Threshold Overhaul (Trades Now Executable)

**Problem:** After 10 analysis runs, zero trades executed. Root cause: `minTradeConfidence` was 72% but max achievable confidence was ~55% due to signal limitations (Google Trends CAPTCHA failures, weak social sentiment proxy, average-weighted confidence math).

**Solution — Multi-pronged fix:**

1. **Lowered base threshold** (`types.ts`): Changed `minTradeConfidence` from 0.72 to 0.55 — aligns with actual signal capability rather than aspirational target.

2. **LLM conviction boost** (`scheduler.ts` line 495-534): Added confidence adjustment based on LLM reasoning verdict BEFORE shouldBuy/shouldSell:
   - LLM agrees + conviction > 0.6 → +25% confidence boost
   - LLM agrees + conviction > 0.3 → +15% confidence boost
   - LLM disagrees → -15% confidence reduction
   - LLM nuanced → no change
   - Capped boosted confidence at 0.95
   - This allows strong signal+LLM alignment to reach trading threshold while weak signals stay filtered.

3. **Tiered position sizing** (`tradingEngine.ts` shouldBuy line 216-233): Replaced binary 70%/100% sizing with 4-tier system:
   - 55-65% confidence → 40% of max position ("toe in the water")
   - 65-75% confidence → 65% of max position (medium)
   - 75-85% confidence → 85% of max position (standard)
   - 85%+ confidence → 100% of max position (full conviction)
   - Position size now proportional to confidence, reducing risk on marginal signals.

4. **Relaxed recommendation filter** (`tradingEngine.ts` shouldBuy line 172-181): Added soft-buy logic for edge cases where composite score > 0.15 (bullish lean) + confidence ≥ 60% but recommendation maps to 'hold' due to tight threshold. Prevents missing good trades blocked by score quantization.

5. **Bug fix** (`signals/index.ts` line 261): Fixed typo `stock.asset_type` → `stock.assetType` for ETF routing consistency.

**Impact:** Trading engine can now execute when signals + LLM align with moderate-to-strong conviction. Conservative 55% base threshold filters weak signals; LLM boost rewards qualitative confirmation. Tiered sizing manages risk exposure proportionally.

**TypeScript:** All changes compile cleanly with `npx tsc --noEmit`.

### 2026-04-15 — Google Trends Signal Fixed (Score Always 50 Bug)

**Problem:** Google Trends signal was returning a score of exactly 50 (neutral) for almost every stock, adding zero value to analysis. After investigation, found 46 out of 50 recent analyses showed score=50, direction=neutral.

**Root Causes Identified:**

1. **Fallback contamination in avgInterest()**: Line 153 of `googleTrends.ts` returned `50` when no data available, rather than `0`. This meant empty data arrays produced a neutral 50 instead of 0.

2. **API failures returning neutral data**: Only 19 stocks had cached Google Trends data. The remaining stocks hit rate limits, insufficient data, or API failures, triggering the `neutralResult()` fallback which returns `{currentInterest: 50, previousInterest: 50, trend: 'stable', changePercent: 0}`.

3. **Neutral fallback diluted real signals**: When Google Trends failed and returned score=50 with confidence=0.1, the aggregator still gave it full 20% weight in the composite score. This injected a meaningless "50" into the calculation, diluting real signals from valuation, trend, and sentiment.

4. **Low search interest is legitimate data**: Cached data showed many stocks with currentInterest values of 0-20, which is REAL data (minimal search interest), not failures. The 0-100 Google Trends scale is relative to peak interest for that keyword.

**Solution — Three-Part Fix:**

1. **Fixed avgInterest() fallback** (`googleTrends.ts` line 153): Changed `return 50` → `return 0`. Empty data means zero interest, not neutral.

2. **Zero-confidence signals excluded** (`searchInterestSignal.ts` line 79): When searchTrend is null/missing, return confidence=0.0 (not 0.1) to signal "exclude me from scoring."

3. **Dynamic weight redistribution** (`signals/index.ts` lines 216-235 for stocks, 332-351 for ETFs): Filter out signals with confidence < 0.05 BEFORE aggregation. Redistribute their weights proportionally to remaining valid signals. This prevents dead signals from diluting the composite score.

**Impact:** 
- When Google Trends succeeds: low interest (0-20) scores appropriately bearish/neutral based on actual search data
- When Google Trends fails: signal is excluded entirely, and its 20% weight redistributes to valuation (35%), trend (25%), and sentiment (20%) → becomes 43.75%, 31.25%, 25% among the 3 valid signals
- Composite scores now reflect only active, confident signals—no more meaningless 50s contaminating analysis

**TypeScript:** Build passes with `npm run build`. Pre-existing errors in reactiveNewsMonitor.ts are unrelated.

### 2026-04-15 — ETF Longer-Horizon Tuning

**User directive:** ETFs need genuinely longer-term analysis — not the same treatment as stocks.

**Changes to `server/src/services/signals/etfSignals.ts`:**

1. **Macro Trend Signal:** Half-life extended from 7→18 days. Added 14 new macro keywords covering energy policy, central bank stance, housing, supply chain, commodities, emerging markets, AI investment, defense spending. Minimum weight floor raised from 0.15→0.25 so older macro articles retain influence.

2. **Sector Momentum Signal:** Lookback extended from 20/60 days to 40/120 days. Added 200-day long-term trend comparison with dedicated score component. Momentum bonus capped at ±8 (was ±15) — ETFs should be patient with short-term dips. Volatility penalty reduced (multiplier 6 vs 10). Full confidence now at 200 data points (was 120).

3. **Market Sentiment Signal:** Half-life extended from 3→7 days. Weight floor raised from 0.12→0.20. Added consensus boost mechanism: when >70% of articles agree on direction, the signal gets amplified proportionally.

4. **Search Interest (ETF):** Rising interest base score raised from 55→58. Contrarian penalty reduced from -5 to -3 and only triggers above 90 (was 85). Stable high-interest score formula improved — sustained interest weighted more positively.

5. **Valuation (ETF):** Added P/B ratio scoring (weight 0.25) alongside P/E (0.35) and yield (0.40). Breakdown now reports P/B in reasoning and data.

6. **Pipeline Weights:** Macro raised from 30%→35%, search interest lowered from 15%→10%. Other weights unchanged. Total sums to 100%.

**ETF routing verified:** `analyzeAsset()` in `index.ts` correctly dispatches to `analyzeETF()` when `stock.assetType === 'etf'`.

**TypeScript:** `npx tsc --noEmit` passes cleanly.

