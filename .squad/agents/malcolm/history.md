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

