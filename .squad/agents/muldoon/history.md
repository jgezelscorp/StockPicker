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
