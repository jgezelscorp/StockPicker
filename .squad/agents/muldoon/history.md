# Muldoon — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: Node.js backend, Azure Web App
- User: Jan G.
- Backend scope: REST APIs, trading engine, background scheduling, data pipelines, database, Azure config

## Learnings

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
