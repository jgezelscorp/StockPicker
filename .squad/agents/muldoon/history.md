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
