# Muldoon — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: Node.js backend, Azure Web App
- User: Jan G.
- Backend scope: REST APIs, trading engine, background scheduling, data pipelines, database, Azure config

## 2026-04-22 — Azure Deployment SUCCESS + Strategy Overhaul Coordination

**DEPLOYMENT COMPLETE (13:07 UTC):**
- ✅ Container Apps live in Sweden Central region
- ✅ Client: https://apex-client.jollyflower-67b1d43f.swedencentral.azurecontainerapps.io
- ✅ API (internal): apex-api.internal.jollyflower-67b1d43f.swedencentral.azurecontainerapps.io
- ✅ 9 pipeline runs, 4 critical fixes applied iteratively
- ✅ Decision documented: ACR admin credentials (interim), upgrade to managed identity when SP elevated to Owner

**Next Phase — Strategy Overhaul Coordination:**
Grant and Malcolm completed two major architectural initiatives (multi-strategy trading + signal engine upgrades). Muldoon's upcoming work:
1. Scheduler redesign for per-strategy cadences (momentum 5-min, value 4-hour, macro daily)
2. Capital allocation enforcement across 3 strategies (25%/35%/40% splits)
3. Cross-strategy rebalancing logic and circuit breakers
4. Integration of 15 new signal modules (5 per strategy)
5. Portfolio-level risk metrics for hedge decisions

Key decisions merged into `.squad/decisions.md` (including deployment ACR decision).

## Learnings

### 2026-04-22 — First Successful Azure Deployment (Run #9)
- **Deployed to**: Azure Container Apps, Sweden Central region
- **Client URL**: https://apex-client.jollyflower-67b1d43f.swedencentral.azurecontainerapps.io
- **API Internal FQDN**: apex-api.internal.jollyflower-67b1d43f.swedencentral.azurecontainerapps.io
- **ACR**: acrsgghlnu2trb7g.azurecr.io
- **Pipeline took 9 runs to succeed.** Issues fixed in order:
  1. **Run #1-4**: Missing `AZURE_RG` secret → Jan added it
  2. **Run #5**: SP lacks `Microsoft.Authorization/roleAssignments/write` → Switched from managed identity AcrPull role assignment to ACR admin credentials
  3. **Run #6**: Empty `ALPHA_VANTAGE_MCP_API_KEY` secret causes Container Apps to reject → Added `!empty()` fallback to `'not-configured'`
  4. **Run #7**: `MANIFEST_UNKNOWN` — Container Apps created before images pushed → Split workflow into foundation (ACR+env) → Docker build/push → full deploy
  5. **Run #8**: Dockerfile `COPY --from=deps /app/server/node_modules` fails — npm workspaces hoist to root `node_modules` only → Removed workspace-level COPY lines
  6. **Run #9**: ✅ SUCCESS — all steps green, ~4.5min total
- **Key decision**: ACR admin credentials instead of managed identity (Contributor SP can't create role assignments). Future: upgrade SP to Owner or add User Access Administrator role, then switch back to managed identity for security.
- **Infra files changed**: `acr.bicep`, `main.bicep`, `container-app-api.bicep`, `container-app-client.bicep`, new `foundation.bicep`
- **Docker files changed**: `Dockerfile.api`, `Dockerfile.client` (removed non-existent workspace node_modules COPY)

### 2025-07-25 — Branch Protection Configuration (BLOCKED — re-confirmed 2025-07-25)
- Attempted to configure branch protection on `master` and `main` branches of `jgezelscorp/Apex` via both the rulesets API and classic branch protection API.
- Desired rules: require 1 PR approval, dismiss stale reviews, admin-only bypass.
- **Blocked**: The authenticated GitHub account (`jangezels_microsoft`) has only **pull** (read) permission on the `jgezelscorp/Apex` repo. Both APIs return 404 without admin access.
- Remote branches confirmed: `main`, `master`, `dependabot/npm_and_yarn/basic-ftp-5.2.2`.
- **Resolution needed**: Jan G. must either (a) grant admin/write rights to `jangezels_microsoft` on the `jgezelscorp/Apex` repo, or (b) configure branch protection directly via GitHub Settings → Branches → Add rule, targeting `master` and `main` with: require PR reviews (1 approval), dismiss stale reviews on push, do not allow bypassing.

### 2025-01-20 — Core Backend Services Implementation
- Created `marketData.ts`: Yahoo Finance v8 API integration with SQLite caching, rate limiting (200ms throttle), support for US/EU/ASIA markets via index symbols. Cache TTL: 5min for quotes, 60min for historical.
- Created `tradingEngine.ts`: Full conviction-based trading engine. Signals aggregated via weighted average; confidence derived from signal agreement (1 – stddev). Buy threshold 72%, sell triggers: confidence < 40% on bearish lean or –8% stop-loss. Position sizing: max 15% portfolio per stock, max 20 positions, 10% cash reserve.
- Created `portfolioTracker.ts`: Portfolio state management, P&L tracking, daily snapshots, Sharpe ratio from daily snapshot returns, decision quality analysis bucketed by confidence range.
- Created `routes/api.ts`: Complete REST API — portfolio, trades (with filters), signals, watchlist CRUD, dashboard aggregation, market data proxy, performance metrics, decision analysis.
- Updated `scheduler.ts`: Wired the full pipeline — market data → signal analysers (existing `signals/` modules) → composite scoring → trading decisions → execution. Learning evaluation delegates to the existing `learningEngine.ts` with weight adjustment. Removed all TODO stubs.
- Discovered existing signal modules (`signals/index.ts`, valuation/trend/sentiment/search) and `learningEngine.ts` written by another agent. Integrated my services to work with those rather than duplicate. My `collectSignals` fallback still exists for raw market-data-only mode.
- Pre-existing TS error in `api.test.ts` (line 268) — type inference issue on `||` fallback object — not mine, left as-is.

### 2026-04-13 — Real API Integration & Stock Discovery
- **API Wrappers Created:** Built three new API modules in `server/src/services/apis/`:
  - `yahooFundamentals.ts`: Yahoo Finance v10 quoteSummary for real P/E, P/B, EPS, market cap, 52-week range, revenue growth, profit margins. 4-hour cache.
  - `finnhub.ts`: Finnhub company news with keyword-based sentiment scoring (25 positive, 27 negative keywords). 2-hour cache. Graceful degradation if no API key.
  - `googleTrends.ts`: google-trends-api for search interest, compares 7-day windows. 6-hour cache. Returns neutral on failure (flaky API).
- **Stock Discovery Service:** `stockDiscovery.ts` with 60+ seed stocks across US (30 stocks + 6 ETFs), Europe (15), and Asia (15). Covers all major sectors. `discoverNewStocks()` uses Yahoo screener for most-active/gainers. `pruneInactiveStocks()` removes 30-day neutral stocks.
- **Scheduler Updated:** Added weekly discovery cron (Sundays 6AM). Pipeline now fetches fundamentals + news + trends per stock, each in try/catch so one API failure doesn't block others. MarketData enriched with real data for Malcolm's signals.
- **New API Endpoints:** POST /api/discover, POST /api/analyze/run, DELETE /api/stocks/:id, GET /api/status (API config + stock counts + last run times). Watchlist now includes last_analysed_at.
- **Startup:** Seeds initial universe on first boot, logs API availability status.
- **Key Decision:** All API wrappers use graceful degradation — return empty/neutral data on failure, never throw. This keeps the pipeline running even when individual APIs are down or rate-limited.
- **Signal Integration:** Malcolm's 4-signal model (Valuation 35%, Trend 25%, Sentiment 20%, Search 20%) fully wired into scheduler. Confidence calculation (1 – stddev) working as designed.
- **Learning Engine Integration:** Malcolm's conservative weight adjustment (±2% max, 5-trade minimum) integrated. Weights read/write to `system_state` JSON.
- **API Contracts Locked:** All 12 endpoints finalized for Ellie's frontend. Response shapes validated by Wu's API tests (9 tests, all passing).
- **Test Validation:** Wu's 82-test suite validates all trading engine contracts (22 tests), confidence thresholds (72% entry, 40% exit), position sizing (15% max, 20 positions, 10% cash), and decision bucketing. 100% pass rate.
- **Dashboard Ready:** Ellie's 4-page React dashboard (Dashboard, Portfolio, Trades, Analysis) with dark theme, CSS variables, centralized hooks. All hooks consume final API contracts. 30-second auto-refresh working end-to-end.

### 2026-04-13 — API Response snake_case Fix
- **Problem:** Frontend expected snake_case keys (`total_value`, `cash_balance`, etc.) but API returned camelCase (`totalValue`, `cashBalance`). Caused `undefined.toFixed()` crashes → black screen.
- **Fixed in `server/src/routes/api.ts`:**
  - `/api/dashboard` portfolio object: converted all 6 keys to snake_case.
  - `/api/portfolio`: converted response to snake_case (was passing raw camelCase object).
  - `/api/status` apis: renamed `yahooFinance` → `yahoo_finance`, `googleTrends` → `google_trends`.
  - Added missing `/api/portfolio/positions` endpoint (frontend calls it but it didn't exist). Returns positions in snake_case.
- **Pattern:** Internal services stay camelCase (TS conventions). API boundary layer converts to snake_case for the React frontend. Conversion happens in route handlers, not in service functions.
- **Portfolio history (`/api/portfolio/history`):** Already correct — raw SQL query returns snake_case column names (`snapshot_at`, `total_value`).
- **Key files:** `server/src/routes/api.ts` (API boundary), `server/src/services/portfolioTracker.ts` (internal camelCase).

### 2026-04-14 — Stock Detail API Endpoint
- **New endpoint:** `GET /api/stocks/:symbolOrId/detail` — accepts numeric stock ID or symbol string. Returns comprehensive data for a rich stock detail popup: stock info, quote, extended fundamentals, 6-timeframe chart data, technical indicators (point + series), latest analysis, recent trades, and position.
- **New file:** `server/src/services/technicalIndicators.ts` — Pure math functions for SMA, EMA, RSI (Wilder smoothing), MACD (12,26,9), Bollinger Bands, ATR. Plus series versions for chart overlays (SMA/EMA/Bollinger/RSI/MACD series).
- **New in marketData.ts:** `fetchChartData(symbol, interval, range, market?)` — supports custom intervals (5m, 60m, 1wk). Cache TTLs: intraday 2min, daily 60min, weekly 120min. Also `fetchExtendedFundamentals()` — fetches beta, forward PE, price-to-sales, debt-to-equity, ROE, FCF via Yahoo quoteSummary v10.
- **Chart timeframes:** 1D (5m intervals), 1W (60m intervals), 1M/3M/1Y (daily), 3Y (weekly). All fetched in parallel via Promise.all for performance.
- **snake_case convention:** All response keys are snake_case. Internal camelCase from Yahoo/services converted at the route boundary.
- **Graceful degradation:** Fundamentals and quote return null (not error) if Yahoo API fails. Charts return empty arrays. Technical indicators return null if insufficient data.
- **82 existing tests still passing.** Zero regressions.

### 2026-04-14 — Persistent Activity Logging System
- **New table:** `activity_log` in `server/src/db/schema.ts` — 6 log levels (`info`, `warn`, `error`, `reasoning`, `trade`, `discovery`), 8 categories (`pipeline`, `signal`, `trade`, `portfolio`, `discovery`, `learning`, `system`, `llm`). Indexed on `created_at`, `category`, `level`. JSON `details` column for structured data.
- **Logger service:** `server/src/services/activityLogger.ts` — `logActivity()` inserts + emits via EventEmitter for SSE. `getRecentLogs()` with pagination/filtering. `pruneOldLogs()` auto-runs on import (30-day TTL). Also writes to `console.log` so terminal output is preserved.
- **Scheduler instrumented:** Pipeline start/complete, per-stock signal collection, signal results, LLM reasoning verdict, buy/sell executions, no-trade decisions, errors, discovery runs, learning evaluations, portfolio snapshots — all logged with structured details.
- **API endpoints:** `GET /api/logs` (paginated, filterable by category/level/since) and `GET /api/logs/stream` (SSE real-time stream using EventEmitter).
- **Key pattern:** `logActivity()` calls sit alongside existing `console.log` statements — both fire. Logger also emits to EventEmitter so SSE clients get real-time updates.
- **Build verified:** Clean `tsc --noEmit` after all changes.

### 2026-04-14 — Verbose Logging Levels (1-5)
- **Schema change:** Added `verbosity INTEGER NOT NULL DEFAULT 3` column to `activity_log` table (CHECK 1-5). Migration handled in `activityLogger.ts` via PRAGMA table_info check + ALTER TABLE for existing DBs.
- **activityLogger.ts:** `logActivity()` now takes optional 6th param `verbosity` (1-5, default 3). `getRecentLogs()` accepts `maxVerbosity` filter. SSE `onLog` emitter includes `verbosity` field in entries.
- **Verbosity levels:** 1=Critical (errors, trades), 2=Important (pipeline lifecycle, discovery, snapshots), 3=Normal (signal summaries, trade decisions), 4=Detailed (per-signal scores, LLM summaries, composite breakdowns), 5=Debug (full API timings, raw LLM prompts/completions, market data assembly).
- **scheduler.ts:** All existing logActivity calls tagged with appropriate verbosity. Added ~15 new logging points: API call timing (v5), per-signal score detail (v4), composite breakdown (v4), LLM prompt/response summaries (v4), full LLM assessment (v5), market data assembly (v5).
- **reasoningEngine.ts:** Added v4 logging for prompt summary and response summary. Added v5 logging for full system+user prompts and raw completion text. Also logs fallback-to-rules at v4.
- **API routes:** `GET /api/logs` accepts `max_verbosity` query param (1-5). `GET /api/logs/stream` SSE endpoint filters by `max_verbosity` before emitting. Default is 5 (show all).
- **Convention preserved:** DB column is snake_case `verbosity`. API param is snake_case `max_verbosity`. Internal JS uses camelCase `maxVerbosity`.
- **Build verified:** Clean `tsc --noEmit`.

### 2025-07-17 — Alpha Vantage API Integration
- **New file:** `server/src/services/alphaVantage.ts` — Alpha Vantage REST API client for OVERVIEW endpoint. Fetches forward P/E, PEG ratio, analyst target price, beta, book value, EV/Revenue, EV/EBITDA, quarterly growth metrics.
- **Rate limiter:** In-memory tracker with 5 calls/minute and 25 calls/day limits (free tier). Warnings logged at 20+ daily calls. Rate-limited requests return null gracefully.
- **Caching:** 24-hour TTL via existing `market_data_cache` SQLite table, keys prefixed `av:overview:`. Company fundamentals are slow-changing, so aggressive caching is appropriate.
- **MarketData interface extended:** 10 new optional fields in `server/src/services/signals/index.ts` for AV data (forwardPE, pegRatio, analystTargetPrice, beta, bookValue, priceToBook, evToRevenue, evToEbitda, quarterlyRevenueGrowthYOY, quarterlyEarningsGrowthYOY).
- **Scheduler integration:** `server/src/services/scheduler.ts` fetches AV overview per stock in the pipeline, wrapped in try/catch. Merged into MarketData alongside Yahoo/Finnhub/Trends data.
- **LLM prompt enrichment:** `server/src/services/llm/reasoningEngine.ts` — new "Enhanced Fundamentals (Alpha Vantage)" section in `buildUserPrompt()` when AV fields are available.
- **Status endpoint:** `server/src/routes/api.ts` — `alpha_vantage` entry added to `/api/status` apis object.
- **Key design decision:** Alpha Vantage is supplementary only — pipeline continues with Yahoo-only data if AV fails or is rate-limited. API key read from `ALPHA_VANTAGE_MCP_API_KEY` env var.
- **Logging:** v3 for fetch success/rate-limit warnings, v4 for field-level detail, v5 for raw API responses.
- **Build verified:** Clean `tsc --noEmit`.
### 2026-04-16 — Alpha Vantage REST API Integration
- **New Service:** server/src/services/alphaVantage.ts — OVERVIEW endpoint integration for company fundamentals.
- **MarketData Extended:** Added 10 new optional fields (forwardPE, pegRatio, targetPrice, beta, bookValue, evToRevenue, evToEbitda, quarterlyGrowthRate, profitMargin, returnOnEquity).
- **Caching:** 24-hour TTL in market_data_cache table (av:overview: prefix). Keeps free-tier usage within 25 calls/day limit.
- **Rate Limiter:** In-memory tracker for 5/min and 25/day usage. Logs warnings at 80% daily usage. Resets daily at midnight UTC.
- **LLM Integration:** reasoningEngine.ts now includes new fields in system prompt for decision context.
- **API Status:** /api/status endpoint now includes alpha_vantage config (API key availability, call counts).
- **Graceful Degradation:** All API wrappers return empty/neutral data on failure (never throw).
- **Files Modified:** signals/index.ts (interface), scheduler.ts (pipeline), reasoningEngine.ts (LLM prompt), routes/api.ts (status).
- **Team Impact:** Malcolm can optionally use new MarketData fields. Ellie sees alpha_vantage in API status. Wu may want unit tests for rate limiter.


### 2026-04-16 — Analysis Runs Observability & Yahoo Finance Extended Fundamentals
- **Analysis Runs Table & Endpoint:** Added nalysis_runs table in db/schema.ts with run metadata (ID, timestamp, duration_ms, stocks_analyzed, signals_generated, trades_executed, error_count, status). Wired unAnalysisPipeline() to insert on start, update on completion. New GET /api/analysis-runs endpoint returns last 10 runs. Enables backend visibility into pipeline throughput and error patterns.
- **Extended Fundamentals Migration:** Replaced Alpha Vantage as primary source with Yahoo Finance quoteSummary. New etchExtendedFundamentals() in marketData.ts queries Yahoo v10 API for company fundamentals. Rationale: Yahoo free tier is stable; AV's 5/min and 25/day limits were restrictive for discovery scale.
- **New Fundamental Fields (7):** MarketData interface extended with: peg_ratio (growth stock valuation), nalyst_target_price (consensus targets), ook_value (P/B context), v_to_revenue (cyclical indicator), v_to_ebitda (asset-heavy context), arnings_quarterly_growth (momentum), operating_margin (efficiency).
- **Scheduler Updated:** Pipeline now calls etchExtendedFundamentals() instead of Alpha Vantage. All 7 new fields merged into MarketData for signal analyzers. Malcolm's 4-signal model gains richer valuation inputs.
- **LLM Context:** reasoningEngine.ts system prompt updated to reference new analyst/valuation fields in decision reasoning.
- **Backward Compatibility:** alphaVantage.ts retained intact for optional use. No breaking changes; existing signals work with partial data.
- **Files Modified:** db/schema.ts (analysis_runs), scheduler.ts (pipeline + run logging), marketData.ts (fetchExtendedFundamentals), reasoningEngine.ts (prompt), routes/api.ts (endpoint).
- **Quality:** Clean TypeScript. 82 existing tests passing. Zero regressions.
- **Team Impact:** Malcolm gains 7 new fields for valuation. Ellie can display analysis run history in ActivityLog. System reduces API dependency concentration.

### 2026-04-16 — ETF-Specific Analysis Pipeline Routing
- **Asset Type Routing:** Updated scheduler.ts to check `stock.asset_type` and route ETFs to `analyzeETF()` (from signals/etfSignals.ts) and stocks to `analyzeStock()`. Graceful fallback: if Malcolm's etfSignals.ts isn't ready yet, ETFs use stock analysis with warning log.
- **Dynamic Import:** Added try-catch wrapper to load analyzeETF dynamically. If file doesn't exist, `analyzeETF` is null and scheduler falls back. Function signature matches: `analyzeETF(marketData: MarketData): Promise<AggregateSignalResult>`.
- **Reasoning Engine Updated:** `analyzeWithReasoning()` now accepts 6th parameter `assetType: string = 'stock'`. LLM prompt context shows "ETF: SPY" vs "Stock: AAPL" based on asset type. Malcolm will add ETF-specific guidance to system prompt.
- **API Type Filtering:** `GET /api/watchlist?type=stock` or `?type=etf` now supported. Added optional `type` query parameter that filters by `asset_type` column in WHERE clause. Response already includes `asset_type` from DB.
- **Pipeline Logging:** Added verbosity level 3 logging for asset type and pipeline selection: `"${symbol}: Using ETF analysis pipeline"` vs stock pipeline. ETF fallback warning logged at level 3.
- **Backward Compatibility:** Stock analysis unchanged. ETFs can use stock signals until Malcolm creates etfSignals.ts. No breaking changes to API contracts or DB schema.
- **Files Modified:** scheduler.ts (routing + ETF import stub + assetType flow), reasoningEngine.ts (assetType param + prompt), api.ts (type filtering).
- **Quality:** Clean TypeScript build (`tsc --noEmit`). Zero regressions.
- **Team Impact:** Malcolm can create ETF signals independently. Ellie gets type filtering for frontend. Grant's architecture supports multi-asset-type expansion.

### 2026-04-17 — Event-Driven Stock Discovery with LLM
- **Problem:** Static discovery based on hardcoded seeds and Yahoo screeners. Watchlist didn't reflect current macro events (wars, tariffs, geopolitical crises). User requested: "when the president does something that would start a war or higher gas prices, the list should reflect stocks that benefit from this".
- **New Service:** `server/src/services/eventDrivenDiscovery.ts` — LLM-powered event-driven discovery that:
  - Fetches news headlines from Finnhub API (general, forex, crypto categories)
  - Analyzes headlines with LLM (via `chatCompletion()`) to identify macro/geopolitical events
  - LLM suggests 5-10 stocks + 2-3 ETFs that BENEFIT from each event
  - LLM identifies 2-3 stocks negatively impacted (for awareness, not added to watchlist)
  - Returns structured JSON with events, beneficiaries, reasoning, and confidence levels
- **Database Schema:** Added 3 new columns to `stocks` table via safe migration in `db/schema.ts`:
  - `discovery_reason TEXT` — why this stock was added (e.g., "Rising oil prices due to Middle East tensions")
  - `discovered_at TEXT` — timestamp when discovered by event system
  - `discovery_event TEXT` — the macro event that triggered it (e.g., "Oil price surge due to sanctions")
- **Scheduler Integration:** 
  - `runAnalysisPipeline()` now runs event-driven discovery BEFORE each analysis cycle (every 4 hours)
  - `runStockDiscovery()` updated to run event discovery first, then fallback to Yahoo screeners
  - Returns `{ discovered, pruned, event_driven }` with counts
- **API Endpoints:** Added 2 new endpoints in `routes/api.ts`:
  - `POST /api/discover/events` — manual trigger for event-driven discovery
  - `GET /api/discover/events/latest` — returns last 50 event-discovered stocks with discovery metadata
- **LLM Prompt Design:** Detailed system prompt instructs LLM to identify geopolitical events (wars, sanctions, trade disputes), macro shifts (rates, inflation), sector catalysts (regulations, policy), energy/commodity moves, currency fluctuations. Returns beneficiaries and negatively impacted stocks with reasoning.
- **Logging:** Full activity logging (v2-v5) for discovery runs, events found, symbols added/reactivated, LLM token usage. All discoveries logged with structured details (event, reason, confidence).
- **Graceful Degradation:** Continues if Finnhub API unavailable, LLM not configured, or parsing fails. Falls back to traditional screener discovery.
- **Files Modified:** `eventDrivenDiscovery.ts` (new), `db/schema.ts` (columns), `scheduler.ts` (pipeline + discovery), `routes/api.ts` (endpoints).
- **Quality:** Clean TypeScript build. Zero regressions.
- **Team Impact:** Malcolm gains richer stock universe reflecting current events. Ellie can display event-driven discoveries in UI. System now dynamically adapts to macro headlines.


### 2026-04-17 — Reactive News Monitor for Instant Trading
- **New Service:** `server/src/services/reactiveNewsMonitor.ts` — Polls Finnhub general market news every 30 minutes during market hours (9 AM - 9 PM UTC weekdays). Detects high-impact events using LLM classification and triggers immediate targeted analysis + trading on affected stocks.
- **LLM News Analysis:** Sends recent headlines to Azure OpenAI with portfolio context. LLM classifies impact (CRITICAL/HIGH/MEDIUM/LOW) and identifies buy candidates (stocks that benefit) + sell candidates (portfolio positions at risk). Returns JSON with event summary, candidates, and portfolio risk.
- **Database Table:** `reactive_events` — tracks detected events with impact level, event summary, news headlines (JSON), buy/sell candidates (JSON), trades executed, timestamps, and duration.
- **Targeted Analysis:** For CRITICAL/HIGH events, runs fast stock-by-stock analysis using existing `analyzeStock()` pipeline (market data → signals → composite score → confidence). Executes trades via `shouldBuy()`/`shouldSell()` logic with confidence threshold 0.55.
- **Scheduler Integration:** Added reactive news monitor cron (`*/30 9-21 * * 1-5`) to `scheduler.ts`. Runs in parallel with existing 4-hour analysis, daily snapshots, weekly learning, and weekly discovery.
- **API Endpoints:** `POST /api/reactive/trigger` (manual trigger for testing), `GET /api/reactive/history` (last 10 events with full details including parsed JSON).

### 2026-07-05 — Portfolio Feature: Manual Sell, Refresh Prices, Strategy Info
- **POST /api/portfolio/sell:** Manual sell endpoint. Validates symbol exists in open positions, checks quantity ≤ held, price > 0. Builds a `TradeOrder` with confidence 1.0 and `manual: true` signal snapshot, delegates to `executeTrade()`. Returns trade_id + updated position info.

### 2026-07-07 — Dashboard News Feed Endpoints
- **Two new endpoints:** `GET /api/news/business` and `GET /api/news/geopolitical` added to `routes/api.ts`.
- **Data source:** Finnhub general news API (`/v1/news?category=general`), same as `reactiveNewsMonitor.ts`. Fetches once, filters twice by keyword lists.
- **Caching:** 15-minute TTL in `market_data_cache` table (key: `general_news:all`). Shared cache between both endpoints to minimize API calls.
- **Keyword filtering:** 30 business keywords (earnings, revenue, market, Fed, etc.) and 28 geopolitical keywords (war, sanction, election, tariff, etc.). Matched against headline + summary.
- **Sentiment scoring:** Local copy of keyword-based scorer (same logic as `finnhub.ts` `scoreSentiment()`). Copied to avoid export dependency.
- **Response shape:** `{ data: [...articles], fetched_at: ISO }`. Each article: headline, source, summary, url, published_at, category, sentiment.
- **Error handling:** Missing FINNHUB_API_KEY returns empty array with message. API failures return empty array. Never throws.
- **Build verified:** Clean `tsc --noEmit` on server. Zero regressions.
- **POST /api/portfolio/refresh-prices:** Thin wrapper exposing `refreshPositionPrices()` from marketData.ts. Returns `{ success, updated: N }`.
- **GET /portfolio/positions enhanced:** Now includes `strategy` object per position with stop-loss price, holding period info, sell confidence threshold, and strategy note. Uses asset_type from stocks table to pick stock vs ETF thresholds.
- **Exported from tradingEngine.ts:** `STOCK_THRESHOLDS`, `ETF_THRESHOLDS`, `AssetThresholds` type, and `getThresholds()` function — previously module-private. Needed by the positions endpoint for strategy calculations.
- **Pattern:** Manual trades use confidence 1.0 and a descriptive rationale — distinguishes them from autonomous trades in the trade log.
- **Rationale Tagging:** All reactive trades tagged with `REACTIVE: {event reason}` in the rationale field for clear attribution to news events vs. scheduled analysis.
- **Key Pattern:** Reuses existing signal analysis, market data fetching, and trading engine — no duplication. Reactive monitor is a thin orchestration layer that identifies WHICH stocks to analyze based on breaking news, then delegates to the proven analysis pipeline.
- **Graceful Degradation:** If Finnhub API key missing, LLM unavailable, or rate limits hit, monitor logs warning and exits cleanly. Scheduled analysis continues unaffected.
- **Activity Logging:** All reactive events logged at verbosity 2-3 (Important/Normal) — event detection, LLM impact classification, trades executed, duration. Full LLM prompts at v5 for debugging.
- **Build Verified:** Clean `tsc --noEmit` compilation. All type conversions (AggregateSignalResult → EvaluationResult, snake_case API fields, logActivity signature) correct.

### 2026-07-14 — ETF-Specific Trading Rules
- **Problem:** Trading engine treated ETFs identically to stocks — wrong for instruments with longer horizons and built-in diversification.
- **Solution:** Introduced `AssetThresholds` interface and separate `STOCK_THRESHOLDS` / `ETF_THRESHOLDS` constants in `tradingEngine.ts`. `shouldBuy()` and `shouldSell()` now accept optional `assetType` parameter (defaults to `'stock'`).
- **ETF Buy Rules:** Higher confidence entry (60% vs 55%), larger max position (20% vs 15% of portfolio), higher starter-tier multiplier (0.50 vs 0.40).
- **ETF Sell Rules:** Wider stop-loss (-15% vs -8%), higher sell confidence threshold (50% vs 40%), stronger protective sell threshold (composite < -0.25 vs -0.1), 14-day minimum holding period with emergency exit at 2x stop-loss (-30%).
- **Scheduler Integration:** `scheduler.ts` already had `assetType` in scope (line 261). Updated both `shouldBuy` and `shouldSell` calls to pass it through.
- **Pattern:** All thresholds logged in trade rationale with `[ETF]`/`[Stock]` tags for audit trail.
- **Key Files:** `server/src/services/tradingEngine.ts` (thresholds + decision logic), `server/src/services/scheduler.ts` (pass-through).
- **Build Verified:** Clean `tsc --noEmit`.

### 2025-07-25 — Azure Container Apps Deployment Pipeline
- **Architecture:** Two-container deployment on Azure Container Apps. `apex-client` (Nginx, external ingress, port 80) reverse-proxies `/api/*` to `apex-api` (Node.js, internal ingress, port 3001). Single public endpoint, no CORS.
- **Dockerfiles:** `Dockerfile.client` (multi-stage: node build → nginx) and `Dockerfile.api` (multi-stage: node build → production with better-sqlite3 native rebuild). Both at repo root.
- **Nginx config:** `nginx/nginx.conf.template` uses envsubst (built into nginx Docker image) to template `${API_URL}` at startup. Gzip enabled, SPA fallback, static asset caching.
- **Bicep infra:** `infra/main.bicep` orchestrates 4 modules: container-apps-env (Log Analytics + CAE), acr (registry + managed identity), container-app-api, container-app-client. Managed identity for ACR pull, no admin creds.
- **CI/CD:** `.github/workflows/deploy.yml` — OIDC login, build+push both images tagged with git SHA, deploy Bicep, update container apps. Triggers on push to main (excludes .squad/ and .md files).
- **SQLite caveat:** EmptyDir volume is ephemeral. Single API replica enforced (SQLite = single writer). Future: migrate to Azure File Share or Azure SQL for durability.
- **Secrets:** FINNHUB_API_KEY and OPENAI_API_KEY passed as Container Apps secrets via Bicep secure params. Azure auth via OIDC federated credentials.

### 2025-07-26 — Deployment Secret Alignment (Azure OpenAI)
- **Problem:** Deployment files referenced `OPENAI_API_KEY` (plain OpenAI) but the project uses Azure OpenAI. Also missing `ALPHA_VANTAGE_MCP_API_KEY`. Health probes pointed to `/api/status` but the actual endpoint is `/api/health`.
- **Fixed across 3 files:**
  - `.github/workflows/deploy.yml`: Removed `openaiApiKey` param, added 5 new params (alphaVantageApiKey, azureOpenaiApiKey, azureOpenaiEndpoint, azureOpenaiDeployment, azureOpenaiApiVersion) from GitHub secrets.
  - `infra/main.bicep`: Replaced `openaiApiKey` with 5 new params (3 @secure, 2 plain config), passed all to container-app-api module.
  - `infra/modules/container-app-api.bicep`: Replaced `openai-api-key` secret with 3 secrets (alpha-vantage, azure-openai-key, azure-openai-endpoint). Added env vars for all 5 new settings. Non-secret config (deployment name, API version) set as plain env vars, not secrets.
  - Fixed health probe paths from `/api/status` to `/api/health` (matches actual Express route in `server/src/index.ts`).
- **Pattern:** Sensitive values (API keys, endpoint URLs) go through Container Apps secrets → secretRef. Non-sensitive config (deployment name, API version) are plain env var values.
- **Key files:** `Dockerfile.client`, `Dockerfile.api`, `nginx/nginx.conf.template`, `infra/main.bicep`, `infra/modules/*.bicep`, `.github/workflows/deploy.yml`.
