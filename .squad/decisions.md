# Squad Decisions

## Active Decisions

### APEX System Architecture (2026-01-20)

**Author:** Grant (Lead / Architect)  
**Status:** Accepted  
**Requested by:** Jan G.

#### Decision 1: Monorepo Structure
```
apex/
├── client/    → React + Vite + TypeScript (dashboard UI)
├── server/    → Express + TypeScript (API + autonomous pipeline)
├── shared/    → Shared TypeScript types (API contracts)
└── package.json (npm workspaces)
```
**Why:** Single repo keeps types in sync, simplifies CI, appropriate for single-team project.

#### Decision 2: Database — SQLite via better-sqlite3
**Why:** Zero infrastructure, portable, fast synchronous reads (better-sqlite3), WAL mode for safe concurrent reads.

**Schema tables:**
- `stocks` — Tracked securities
- `signals` — Individual data captures
- `analysis_logs` — Composite scoring results per stock per run
- `trades` — Every buy/sell with rationale & signal snapshot
- `portfolio_positions` — Current open positions with live P&L
- `portfolio_snapshots` — Daily value tracking for performance charts
- `learning_outcomes` — Post-trade evaluations linking predictions to reality
- `system_state` — Key-value store for scheduler metadata, cash balance

#### Decision 3: Backend Architecture
Autonomous pipeline (node-cron, 4-hour market-aware cycle):
- Signal Collection → Composite Analysis → Trading Engine → Logging & Snapshot
- Weekly Learning Evaluation cycle

Service modules: SignalCollector, Analyser, TradingEngine, PortfolioManager, LearningEngine

#### Decision 4: API Design
All endpoints prefixed with `/api/`:
- `GET /health` — Service health check
- `GET /dashboard` — Aggregated dashboard data
- `GET /stocks?market=` — List tracked stocks
- `POST /stocks` — Add stock to watchlist
- `GET /trades?page=&pageSize=` — Paginated trade log
- `GET /portfolio/positions` — Current open positions
- `GET /portfolio/history?days=` — Historical portfolio value
- `GET /analysis?stockId=` — Analysis results
- `GET /performance` — Win rate, P&L, profit factor
- `GET /learning` — Learning outcomes

**Client-server:** REST over JSON. Vite dev server proxies `/api` to Express on port 3001. In production, Express serves built React bundle.

#### Decision 5: Signal Pipeline Design

**Signal Sources & Weights:**
| Source | Weight | Data |
|---|---|---|
| P/E Ratio | 20% | Valuation relative to sector/market average |
| Price Trend | 20% | Moving averages, momentum, RSI-style indicators |
| Macro Trends | 15% | Market indices, interest rates, sector rotation |
| Google Trends | 10% | Search interest as proxy for retail attention |
| Social Sentiment | 15% | Twitter/X volume & sentiment around ticker |
| News Sentiment | 20% | Financial news NLP sentiment & event detection |

Each signal produces normalised `direction` (bullish/bearish/neutral) and `strength` (0–1). Composite analyser combines using weighted averaging, maps to recommendation (strong_buy through strong_sell).

**Confidence Scoring:** Reflects agreement across sources. High confidence (>72%) only triggers trades.

#### Decision 6: Trading Engine Design
- **Entry threshold:** Composite confidence ≥ 72%
- **Exit triggers:** Confidence < 40% on held position OR stop-loss at –8%
- **Position sizing:** Max 15% of portfolio per position
- **Portfolio limits:** Max 20 simultaneous positions
- **Cash reserve:** ≥10% always maintained
- **Starting capital:** $100,000 virtual

Every trade records: influencing signals, composite score, confidence, human-readable rationale, full signal snapshot.

#### Decision 7: Learning System Design

Weekly evaluation cycle:
1. Find all closed positions not yet evaluated
2. Compare expected return (from buy-time confidence) vs actual return
3. Record: profitable? Signal accuracy?
4. Over time: adjust signal weights based on predictive accuracy

Initial version uses fixed weights with passive tracking. Phase 2 enhances with automatic weight adjustment feedback loop.

#### Decision 8: Deployment Target — Azure Web App
- Single Azure Web App running Express server
- SQLite database file on persistent storage
- Client built statically, served by Express
- Environment variables for API keys
- Node-cron handles scheduling

---

## Implementation Phase 1 Decisions

### Backend Service Architecture (2026-04-13)

**Author:** Muldoon (Backend Dev)  
**Status:** Implemented  
**Related:** APEX System Architecture Decision 3 & 4

#### Key Decisions

1. **Market Data via Yahoo Finance v8** — No API key required, covers US/EU/ASIA via index symbols. Quotes cached 5min, historical 60min in SQLite. Rate-limited to 200ms between requests. Falls back gracefully on 429s.

2. **Trading Engine uses signal agreement as confidence** — Confidence = 1 – stddev of directional signal values. This naturally penalises conflicting signals. Composite score is the weighted average of directional values (–1 to +1).

3. **Integrated with existing signal modules** — The scheduler feeds market data into the existing `analyzeStock()` pipeline rather than duplicating signal logic. Learning engine weight adjustments flow back into the next analysis run.

4. **REST API on separate router** — Moved all endpoints out of `index.ts` into `routes/api.ts`, mounted at `/api`. Cleaner separation. Old inline routes in index.ts removed.

5. **Position sizing scales with conviction** — `strong_buy` gets full 15% allocation, regular `buy` gets 70% of max. 10% cash reserve always maintained.

#### Consequences

- Yahoo Finance unofficial API may change without notice — should add Alpha Vantage as fallback
- Signal proxies for social/news/google are derived from price action until real APIs are integrated
- No WebSocket support yet — dashboard polls on interval

---

### Signal Pipeline Architecture (2026-04-13)

**Author:** Malcolm (Data Engineer)  
**Status:** Implemented  
**Related:** APEX System Architecture Decision 5

#### Key Decisions

1. Implemented the task spec's 4-signal model (vs Grant's ADR 6-source model):
   - **Valuation** (35%) — consolidated P/E, P/B, and dividend yield into one signal
   - **Trend** (25%) — MA crossovers + volume analysis
   - **Sentiment** (20%) — aggregates news + social into one pipeline
   - **Search Interest** (20%) — Google Trends proxy

2. **Signal-to-DB Mapping** — Each signal produces 0–100 score internally, mapped to -1..+1 for `analysis_logs.composite_score` column and to SignalDirection for `signals` table.

3. **Learning Engine Conservative Tuning** — Max ±2% per cycle, minimum 5 evaluated trades before adjustment, weights bounded 5%–50% per signal. Weights stored in `system_state` table as JSON under `signal_weights` key.

#### Consequences

- Macro trend signal is deferred — no data source yet
- News and social sentiment are aggregated as one signal (weighted 55/45 internally)
- Mock data is deterministic per symbol, ready for real API plug-in
- Learning engine is functional but needs real trade data to start adjusting

---

### Frontend Dashboard Architecture (2026-04-13)

**Author:** Ellie (Frontend Dev)  
**Status:** Implemented  
**Related:** APEX System Architecture Decision 1 & 4

#### Key Decisions

1. **CSS Variables over CSS-in-JS** — Using global `globals.css` with CSS custom properties for dark financial theme. Avoids styled-components/emotion dependency, keeps bundle lean, consistent `var(--profit)` / `var(--loss)` tokens.

2. **Layout via `<Outlet />`** — Layout.tsx component uses React Router's `<Outlet />` for nested routing. Sidebar and header stay mounted across page transitions. Header shows live portfolio value from dashboard API hook.

3. **Centralized API Hooks** — All data fetching lives in `hooks/useApi.ts`. Every hook wraps @tanstack/react-query with 30-second auto-refresh interval. Components never call `api.*` directly.

4. **Client-side Filtering (Trades)** — Trade filters (symbol, action, date range) run client-side on fetched page. Acceptable for 50-row page size. When Muldoon adds server-side params, hooks can forward them with zero component changes.

5. **Derived Analytics Charts** — Signal accuracy and decision-quality-over-time computed from `learning_outcomes` data using `useMemo`. No additional API endpoints needed.

#### Consequences

- New financial colors should be added as CSS variables in `globals.css`
- Pages depend on API response shape from Grant's architecture doc. If Muldoon changes formats, `useApi.ts` hooks are the single place to update.
- Recharts is the only charting dependency.

---

### Test Strategy — Schema-Driven with In-Memory SQLite (2026-04-13)

**Author:** Wu (Tester)  
**Status:** Implemented  
**Related:** APEX System Architecture Decisions 2 & 6

#### Key Decisions

1. **Tests written against DB schema and shared types** rather than importing service modules. Each test creates fresh in-memory SQLite DB via `new Database(':memory:')` + `initializeSchema()`. 

2. **Pure-logic helpers mirror service expectations** — Signal scoring, weight adjustment, trade execution tested as contracts. Tests validate the *contracts* and will catch regressions once real services are wired in.

3. **Schema first, implementation agnostic** — If schema changes, tests break immediately (good early warning). When services land, can add integration tests importing real modules.

#### Consequences

- Tests run in ~1 second with zero external dependencies
- No mocking of HTTP or service layers needed for core logic
- 82 tests across 5 suites, 100% passing
- All architectural constraints validated (confidence gating, position sizing, signal bounds)

---

## Phase 2 Decisions

### Activity Logging System (2026-04-14)

**Author:** Muldoon (Backend Dev)  
**Status:** Implemented  
**Requested by:** Jan G.

#### Summary

Added a persistent activity logging system so the UI can display a real-time log pane showing what the analysis pipeline is doing.

#### What Changed

1. **`activity_log` table** in SQLite schema — stores every pipeline event with level, category, optional symbol, message, and JSON details. Auto-pruned after 30 days.

2. **`activityLogger.ts` service** — centralised `logActivity()` function that writes to DB + emits via EventEmitter for SSE streaming. Also writes to console for terminal visibility.

3. **Scheduler instrumented** — 11 distinct log points across the pipeline: start, per-stock signals, signal results, LLM reasoning, buy/sell trades, skipped stocks, errors, completion, discovery, learning, and snapshots.

4. **Two new API endpoints:**
   - `GET /api/logs` — paginated, filterable log retrieval (limit, offset, category, level, since)
   - `GET /api/logs/stream` — Server-Sent Events for real-time streaming

#### API Contract

```
GET /api/logs?limit=100&offset=0&category=pipeline&level=info&since=2026-04-13T00:00:00Z
→ { success: true, data: { logs: ActivityLogEntry[], total: number } }

GET /api/logs/stream
→ SSE stream, each event: data: { id, level, category, symbol, message, details, created_at }
→ Initial event: data: { type: "connected" }
```

#### Consequences

- SSE endpoint keeps connections open — `emitter.setMaxListeners(50)` allows up to 50 concurrent viewers.
- All log keys are snake_case at the API boundary (consistent with existing convention).
- Frontend can filter by category (`pipeline`, `signal`, `trade`, `llm`, etc.) and level (`reasoning`, `trade`, `error`, etc.) to show different views.

---

### Activity Log UI Pattern (2026-04-15)

**Author:** Ellie (Frontend Dev)  
**Status:** Implemented

#### Decision

Activity Log uses a dual-data strategy: initial REST fetch (`GET /api/logs?limit=200`) merged with SSE stream (`/api/logs/stream`), deduplicated by `id`. This gives instant history on page load plus real-time updates.

#### Key Choices

1. **SSE over WebSocket** — Server-Sent Events is simpler, auto-reconnects natively, and fits our one-way log stream use case.

2. **500-entry client buffer** — SSE hook caps at 500 entries in memory to prevent unbounded growth during long sessions. Older entries remain available via REST pagination.

3. **10-second polling fallback** — `useActivityLogs` hook polls every 10s as fallback when SSE is unavailable or disconnected.

4. **Reasoning level highlighted purple** — LLM reasoning entries get `#a855f7` purple styling to stand out from operational logs.

#### Consequences

- Backend must return `id` field on every log entry for deduplication to work
- SSE endpoint must send JSON objects with at minimum: `id`, `level`, `category`, `message`, `created_at`
- The `details` field is optional; when present, clicking a row expands formatted JSON

---

### Discovery Page UI Conventions (2026-04-14)

**Author:** Ellie (Frontend Dev)  
**Status:** Implemented

#### Key Design Decisions

1. **Market color scheme standardized:** US=blue (#58a6ff), EU=green (#3fb950), ASIA=orange (#f0883e). Used in badges and table rows.

2. **Dual-case field handling:** The new hooks accept both `snake_case` and `camelCase` response fields (e.g., `last_analysis_run` OR `lastAnalysisRun`).

3. **Mutation invalidation pattern:** Discovery/Analysis mutations invalidate `['watchlist']`, `['system-status']`, and `['analysis']` query caches.

4. **Watchlist refresh at 60s (not 30s):** Watchlist data changes less frequently than portfolio/trades, so it polls at 60s to reduce backend load.

5. **Action button color:** `#00d4aa` used for primary action buttons per task spec. Distinct from `var(--accent)` (#58a6ff) used for links/navigation.

#### Impact

- Nav now has 5 items — Layout.tsx NAV_ITEMS array is the source of truth
- 5 new API endpoints consumed — `/api/watchlist`, `/api/status`, `POST /api/discover`, `POST /api/analyze/run`, `DELETE /api/stocks/:id`

---

### Stock Detail Modal Architecture (2026-04-15)

**Author:** Ellie (Frontend Dev)  
**Status:** Implemented

#### Decision

Built a full-screen stock detail modal (`StockDetailModal.tsx`) as a shared component importable from any page. Clicking any stock symbol in the app opens it.

#### Key Choices

1. **Single shared component, per-page state** — Each page manages its own `selectedStock` state rather than a global context.

2. **API: `GET /api/stocks/:symbolOrId/detail`** — Single endpoint returns everything (stock info, charts per timeframe, indicator series, fundamentals, technicals, analysis, trades, position).

3. **Indicator data merged at render time** — Chart data and indicator series arrive as separate objects from the API. We merge them in a `useMemo` keyed to the active timeframe.

4. **RSI and MACD as conditional sub-charts** — Rather than overlaying on the price chart (different Y scales), RSI and MACD render as separate `<LineChart>` / `<ComposedChart>` components below volume, synced via Recharts `syncId`.

5. **60-second staleTime** — Stock detail data refreshes less aggressively than dashboard hooks (30s) since it's an on-demand drill-down.

#### Consequences

- The modal expects snake_case keys from the API (`indicator_series`, `latest_analysis`, `recent_trades`, etc.).
- No URL state for the modal. Could add later with a query param if needed.

---

### API responses use snake_case at the boundary (2026-04-13)

**Author:** Muldoon (Backend)  
**Status:** Implemented

#### Context

The React frontend expects snake_case property names (e.g. `total_value`, `cash_balance`), but the server's internal TypeScript services use camelCase (e.g. `totalValue`, `cashBalance`). The API was leaking camelCase to the client, causing `undefined.toFixed()` crashes.

#### Decision

- **Internal services stay camelCase** — standard TypeScript convention.
- **Route handlers convert to snake_case** at the API boundary before sending JSON responses.
- This conversion is explicit (manual mapping), not automatic (no middleware). This keeps it visible and predictable.

#### Affected Endpoints

- `GET /api/portfolio` — portfolio summary in snake_case
- `GET /api/portfolio/positions` — new endpoint, positions in snake_case
- `GET /api/dashboard` — portfolio block in snake_case
- `GET /api/status` — api keys: `yahoo_finance`, `google_trends`

#### Team Impact

- **Ellie (Frontend):** All API responses now match what the hooks expect.
- **Wu (QA):** API test assertions may need updating if they check for camelCase keys.

---

### Real API Integration Architecture (2026-04-13)

**Author:** Muldoon (Backend Dev)  
**Status:** Implemented

#### Context

APEX was running on mock/stub data for sentiment, news, search interest, and valuation fundamentals. Stocks had to be manually added. The agent needed to build its own stock universe and use real free API data.

#### Decision

Built a three-layer data fetching architecture with graceful degradation:

1. **Yahoo Finance v10 quoteSummary** — Real fundamentals (P/E, P/B, EPS, market cap, margins). No API key required. 4-hour cache.
2. **Finnhub** — Real company news with keyword-based sentiment scoring. Free tier (60 calls/min). 2-hour cache. Optional — works without API key.
3. **google-trends-api** — Real search interest data. No key needed. 6-hour cache. Flaky API — returns neutral on failure.

Stock discovery via Yahoo Finance screener endpoints, seeded with 60+ global stocks across 3 regions.

#### Key Principles

- **Never throw**: All API wrappers return empty/null on failure. The pipeline continues.
- **Cache aggressively**: Fundamentals (4h), news (2h), trends (6h) to respect rate limits.
- **Each API call is independent**: Wrapped in separate try/catch in the scheduler. One failing API doesn't block others.
- **Malcolm's signals are untouched**: Data layer provides enriched MarketData; signal analysis remains Malcolm's domain.

#### Trade-offs

- Yahoo Finance unofficial API could break — but it's the most complete free option.
- Keyword sentiment is basic compared to NLP — acceptable for v1, can be upgraded later.
- Google Trends is unreliable — 6-hour cache and neutral fallback mitigate this.

#### Impact

- Malcolm's signal analyzers now receive real PE ratios, news articles, and search trends.
- Stock universe auto-seeds on startup (60+ stocks) and discovers new ones weekly.
- System degrades gracefully — worst case falls back to price-only analysis.

---

### Stock Detail API Endpoint (2026-04-14)

**Author:** Muldoon (Backend Dev)  
**Status:** Implemented

#### What

New endpoint `GET /api/stocks/:symbolOrId/detail` that returns all data needed for a rich stock detail popup in a single request.

#### Key Design Choices

1. **Single-request aggregation** — Frontend makes one call, backend fans out to 8 parallel data fetches (quote + fundamentals + 6 chart timeframes).

2. **Technical indicators computed server-side** — Pure functions in `technicalIndicators.ts`. Both point-in-time values (latest SMA/EMA/RSI/MACD/Bollinger/ATR) and full series arrays for chart overlays.

3. **Chart interval caching** — Intraday data (5m, 60m) cached 2 minutes. Daily data cached 60 minutes. Weekly data cached 120 minutes.

4. **Extended fundamentals** — Adds beta, forward PE, price-to-sales, debt-to-equity, ROE, and FCF.

5. **Accepts ID or symbol** — Param is parsed as number first; falls back to symbol lookup.

#### Files Changed

- `server/src/services/technicalIndicators.ts` (new)
- `server/src/services/marketData.ts` (added `fetchChartData`, `fetchExtendedFundamentals`)
- `server/src/routes/api.ts` (added `/stocks/:symbolOrId/detail`)

#### For Ellie (Frontend)

The endpoint is ready to consume. Response shape matches the agreed spec exactly with all snake_case keys. Chart arrays contain `{ date, open, high, low, close, volume }` objects. Indicator series contain `{ date, value }` pairs aligned with the 3M chart data points.

---

### Signal Pipeline: Real Data Migration (2026-04-14)

**Author:** Malcolm (Data Engineer)  
**Status:** Implemented

#### Decision

Rewrote all 4 signal analyzers to consume real market data instead of mock/stub functions. Signals now depend entirely on the `MarketData` interface — no direct API imports.

#### Changes

**1. MarketData Interface Expanded**
Added 8 new optional fields: `eps`, `marketCap`, `week52High/Low`, `revenueGrowth`, `profitMargin`, `newsArticles[]`, `searchTrend`. All backward-compatible (optional).

**2. Valuation Signal — Multi-Factor Real Data**
- Real P/E, P/B, dividend yield from Yahoo Fundamentals
- Market cap tier adjustment: mega-caps tolerate higher P/E before being "overvalued"
- 52-week position scoring: stocks near 52w low with decent fundamentals = potential value
- Revenue growth and profit margin as quality signals
- Confidence tiered by data availability (3 core metrics = high, 0 = neutral fallback)

**3. Sentiment Signal — Real Finnhub News**
- All mock functions removed. Consumes `newsArticles` with pre-scored sentiment
- Recency-weighted averaging (24-hour half-life — yesterday's news counts half as much)
- Consensus measurement: 70%+ agreement amplifies signal, mixed sentiment → lower confidence

**4. Search Interest Signal — Real Google Trends**
- All mock functions removed. Consumes `searchTrend` from Google Trends API
- Contrarian element: very high interest (>80) dampens bullish score (everyone already in)
- High + falling = peak passed (extra bearish)

**5. Trend Signal — Minor Improvement**
- Partial data handling: SMA50 alone now contributes meaningful signal

#### Key Design Principle: Graceful Degradation

Every signal returns `{ score: 50, confidence: 0.1, direction: 'neutral' }` when data is unavailable.

#### Consequences

- Signals now depend on Muldoon's API wrappers to populate MarketData correctly
- Social sentiment is approximated from news data — real Reddit/StockTwits API would improve this
- Sector averages are static defaults; could be dynamically fetched in future
- Wu's existing tests may need updates to account for new breakdown fields

---

### Verbose Logging Levels (1-5) (2026-04-14)

**Author:** Muldoon (Backend Dev)  
**Status:** Implemented  
**Requested by:** Jan G.

#### Decision

Activity logging now supports verbosity levels 1-5:

| Level | Label | What's logged |
|-------|-------|---------------|
| 1 | Critical | Errors, executed trades |
| 2 | Important | Pipeline start/complete, discovery, snapshots, scheduler lifecycle |
| 3 | Normal | Signal summaries, trade decisions (default) |
| 4 | Detailed | Per-signal scores, LLM prompt/response summaries, composite breakdowns |
| 5 | Debug | Full LLM prompts/completions, API call timings, raw market data |

#### API Contract

- `GET /api/logs?max_verbosity=3` — returns logs where verbosity ≤ 3
- `GET /api/logs/stream?max_verbosity=3` — SSE stream filtered the same way
- Default `max_verbosity` is 5 (show everything)
- Each log entry now includes a `verbosity` integer field

#### Impact on Frontend

Ellie: The `/api/logs` and `/api/logs/stream` endpoints now return a `verbosity` field on each log entry. The Activity Log page needs a verbosity selector (1-5 slider or dropdown) that passes `max_verbosity` as a query param to both endpoints. Existing behaviour is unchanged at default (level 5 = show all).

#### DB Migration

Handled automatically — existing `activity_log` rows get `verbosity = 3` (the default). No manual migration needed.

---

### StockDetailModal API Field Mapping (2026-04-16)

**Author:** Ellie (Frontend Dev)  
**Status:** Applied

#### Context
StockDetailModal had three bugs where frontend field access didn't match the server response shape.

#### Decisions

1. **Chart timeframe keys are UPPERCASE** — The `Timeframe` type (`'1D' | '1W'` etc.) matches server keys directly. No mapping layer needed. Removed `TIMEFRAME_KEYS`.

2. **Live price data lives in `detail.quote`, not `detail.stock`** — The `stock` object has DB metadata only (symbol, name, market, sector). The `quote` object has live market data (price, change, change_pct, volume, market_cap, pe, exchange, currency, previous_close). All price displays must use `quote.*`.

3. **Indicator series is top-level, 3M only** — Server returns `detail.indicator_series` as a flat object of indicator arrays (not nested per-timeframe). These correspond to the 3M chart data. Indicator overlays should only merge when `timeframe === '3M'`.

4. **Trade confidence field is `confidence`, not `confidence_level`** — Server returns `confidence` on trade objects. Added fallback for both field names.

#### Impact
All team members writing UI that consumes `/api/stocks/:id/detail` should reference this mapping.

---

### Verbosity Selector UI (2026-04-15)

**Author:** Ellie (Frontend Dev)  
**Status:** Implemented

#### Decision

Added verbosity selector (1-5 segmented control) to ActivityLog page. Wired `max_verbosity` query parameter to API client and SSE stream hook.

#### Key Choices

1. **Segmented control** — 5 buttons (1–5) for quick verbosity selection, persisted to component state
2. **API integration** — `useLogStream.ts` hook passes `max_verbosity` to both REST (`GET /api/logs?max_verbosity=...`) and SSE (`/api/logs/stream?max_verbosity=...`) calls
3. **Default: 3 (Normal)** — Shows typical operational logs; users can increase to 4–5 for debugging or decrease to 1–2 for critical-only view

#### Files Updated

- `ActivityLog.tsx` — added segmented control UI
- `useLogStream.ts` — threaded `max_verbosity` parameter
- `client.ts` — API client forwards parameter
- `useApi.ts` — hook integration
- `reasoningEngine.ts` — added `max_verbosity` to reasoning log calls

---

### Alpha Vantage MCP Integration (Planned) (2026-04-15)

**Author:** Jan G. (via Coordinator)  
**Status:** Pending  
**Decision:** Planned Future Work

#### What
User suggested adding Alpha Vantage MCP server (https://mcp.alphavantage.co/) to enhance the reasoning engine's stock analysis. This provides real-time/historical stock data, technical indicators, and company fundamentals via MCP protocol.

#### Why
Would significantly improve signal quality for the stock-picking agent. Free API key available. Can be used as an additional data source alongside Yahoo Finance and Finnhub.

#### Status & Next Steps
Needs API key from user. Integration approach: add as MCP server config + wire into reasoning engine as an additional signal source.

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

---

# Decision: Client-Side Countdown for Next Scheduled Run

**Author:** Ellie (Frontend Dev)
**Date:** 2026-04-16
**Status:** Implemented

## Context
The Discovery page needed a live countdown to the next analysis run. The backend does not expose a `next_scheduled_run` field.

## Decision
Calculate the next run time **client-side** as `last_analysis_run + 4 hours` (matching the `0 */4 * * *` cron). A `useCountdown` hook ticks every second and displays `HH:MM:SS`.

## Trade-offs
- **Pro:** No backend change required; works immediately.
- **Pro:** Self-corrects on every status refetch (30s interval updates `last_analysis_run`).
- **Con:** If the cron schedule changes server-side, the frontend hardcodes 4 hours. Muldoon could later add `next_scheduled_run` to the status endpoint to make this dynamic.
- **Con:** Slight drift possible if the analysis run doesn't start exactly on cron tick.

## Team Impact
- **Muldoon:** If you add `next_scheduled_run` to `/api/status`, ping me and I'll swap out the client-side calc for the server value.
- **Malcolm:** No impact on analysis logic.

---

# Decision: Alpha Vantage API Integration

**Author:** Muldoon (Backend Dev)
**Date:** 2025-07-17
**Status:** Implemented

## What
Added Alpha Vantage REST API as a supplementary data source for company fundamentals (OVERVIEW endpoint). Enriches MarketData with forward P/E, PEG ratio, analyst target price, beta, book value, EV multiples, and quarterly growth metrics.

## Key Design Choices

1. **Supplementary, never required** — If AV fails or is rate-limited, the pipeline continues with Yahoo-only data. No code path depends on AV being available.

2. **Aggressive caching (24h)** — Company fundamentals are slow-changing. Cached in existing `market_data_cache` table with `av:overview:` prefix. This keeps free-tier usage well within the 25 calls/day limit.

3. **In-memory rate limiter** — Tracks per-minute (5/min) and daily (25/day) usage. Logs warnings when approaching daily limit. Resets daily count at midnight.

4. **ENV var:** `ALPHA_VANTAGE_MCP_API_KEY` — same key name the user configured in `.env`.

## Files Changed
- **Created:** `server/src/services/alphaVantage.ts`
- **Modified:** `server/src/services/signals/index.ts` (MarketData interface)
- **Modified:** `server/src/services/scheduler.ts` (pipeline data-fetch)
- **Modified:** `server/src/services/llm/reasoningEngine.ts` (LLM prompt)
- **Modified:** `server/src/routes/api.ts` (status endpoint)

## Impact on Other Agents
- **Malcolm (Signals):** MarketData interface now has 10 new optional fields. Signal analyzers can optionally use them but don't need to — all are `?` optional.
- **Ellie (Frontend):** `/api/status` now includes `alpha_vantage` in the apis object. No UI changes required unless she wants to display it.
- **Wu (Tests):** New service has no tests yet. May want to add unit tests for the rate limiter and cache behavior.

---

# Decision: ETF-Specific Signal Analysis Architecture

**Author:** Malcolm (Data Engineer)  
**Date:** 2026-04-14  
**Status:** Implemented  
**Requested by:** Jan G.

## Context

The original signal pipeline was designed for individual stocks with weights optimized for company-level analysis:
- Valuation (P/E, P/B) 35%
- Price Trend 25%
- Sentiment 20%
- Search Interest 20%

This approach doesn't work well for ETFs because:
1. ETF P/E ratios are less meaningful than for individual companies
2. ETFs are driven by macro trends, not company-specific events
3. Sector composition and rotation matter more than individual fundamentals
4. Investment horizon is typically longer (weeks/months vs days)
5. Geopolitical and economic trends have outsized impact

## Decision

Created a separate ETF analysis pipeline with fundamentally different signal weights and logic:

---

## Decision: Dynamic Signal Weight Redistribution (2026-04-14)

**Date:** 2026-04-14  
**Author:** Malcolm (Data Engineer)  
**Status:** Implemented  
**Related Files:**
- `server/src/services/apis/googleTrends.ts`
- `server/src/services/signals/searchInterestSignal.ts`
- `server/src/services/signals/index.ts`

### Context: Google Trends Signal Reliability Issue

Google Trends signal was contributing meaningless neutral scores (50) to analysis when:
- API rate limits hit (very common after 7+ rapid requests)
- Insufficient data for a stock symbol
- Network/parse errors

This injected neutral 50s into composite scores even though the signal had effectively failed, diluting the value of working signals (valuation, trend, sentiment).

### Decision: Implement Dynamic Weight Redistribution for Failed Signals

**Changes Made:**

1. **Signals with confidence < 0.05 are now EXCLUDED** from composite score calculation
2. **Their weights are REDISTRIBUTED PROPORTIONALLY** to remaining valid signals
3. This applies to both stock and ETF analysis pipelines

### Example

Default stock weights:
- Valuation: 35%
- Trend: 25%
- Sentiment: 20%
- Google Trends: 20%

When Google Trends fails (confidence=0.0):
- Valuation: 35% / 0.80 = **43.75%**
- Trend: 25% / 0.80 = **31.25%**
- Sentiment: 20% / 0.80 = **25.0%**
- Google Trends: **excluded**

### Rationale

**Rejected alternatives:**
- Keep scoring failed signals as 50: Dilutes real data with noise
- Default confidence to 0.1 instead of 0.0: Still contributes to composite, just weakly
- Remove Google Trends entirely: Loses valuable signal when it DOES work (low search interest IS meaningful)

**Why this works:**
- Preserves signal value when data is available (low interest = bearish lean)
- Eliminates contamination when data fails
- Generalizes to any future signal source failures
- Learning engine can still adjust weights for present signals

### Impact

- Composite scores now based only on valid, confident signals
- When Google Trends works, low interest (0-20) scores appropriately
- When it fails, analysis doesn't suffer from injected neutrality
- Future signal additions benefit from same graceful degradation

### Team Notes

This pattern should be used for all future signal integrations. When adding a new signal source:
1. Return confidence=0.0 when data is unavailable/unreliable
2. The aggregator will automatically exclude and redistribute weights
3. Never inject neutral 50s as a "safe default" — exclusion is safer

---

## Decision: Reactive News Monitor Design (2026-04-14)

**Date:** 2026-04-14  
**Author:** Muldoon (Backend Dev)  
**Status:** Implemented  
**Related Files:**
- `server/src/services/reactiveNewsMonitor.ts` (new)
- `server/src/services/scheduler.ts`
- `server/src/services/llm/provider.ts`
- `server/src/services/tradingEngine.ts`
- `server/src/routes/api.ts`
- `server/src/db/schema.ts`

### Context: Event-Driven Trading Opportunity

User wanted the agent to react to breaking news IMMEDIATELY rather than waiting for the next 4-hour analysis cycle. Example: if there's a change in the Iran situation, the agent should instantly analyze and trade affected stocks (oil, defense, airlines, etc.). The existing event-driven discovery only DISCOVERED stocks — it didn't trigger immediate trades.

### Decision: Build Reactive News Monitoring System

Polls Finnhub general market news every 30 minutes, uses LLM to classify impact, and triggers targeted analysis + trading on CRITICAL/HIGH events.

### Key Design Decisions

#### 1. Polling Frequency: Every 30 Minutes
- **Rationale:** Balances timeliness with API rate limits. More frequent polling would hit Finnhub limits quickly.
- **Cron:** `*/30 9-21 * * 1-5` — every 30 minutes during market hours (9 AM - 9 PM UTC, weekdays).
- **Alternative Considered:** Real-time webhooks — not available on Finnhub free tier.

#### 2. LLM-Based Impact Classification
- **Why:** Keyword matching would miss nuanced events. LLM can understand context (e.g., "Iran tensions escalate" → oil price impact).
- **Impact Levels:** 
  - CRITICAL (war, sanctions, major policy) → immediate action
  - HIGH (earnings surprises, major deals) → quick analysis
  - MEDIUM/LOW → skip, let normal cycle handle
- **Output:** JSON with buy candidates, sell candidates, and portfolio risk assessment.

#### 3. Targeted Analysis (Not Full Universe)
- **Why:** Running full 100+ stock analysis every 30 minutes would be wasteful and expensive (LLM tokens, API calls).
- **Approach:** LLM identifies 5-10 specific stocks impacted by the event, then we analyze ONLY those stocks.
- **Example:** "Iran tensions" → analyze XOM, CVX, COP (beneficiaries), TSLA (at risk).

---

## 2026-04-14T2032: User Directive — ETF Analysis Strategy

**Author:** Jan G. (via Copilot)  
**Status:** Accepted  

### Decision: Differentiate ETF Analysis from Stock Analysis

ETFs require a fundamentally different analysis strategy than stocks. The agent must NOT treat them the same.

**Key Differences:**
- **Investment Horizon:** Longer-term (avoid day-trading volatility)
- **Analysis Weight:** Heavier emphasis on macro/geopolitics, sector composition, long-term trends
- **Data Sources:** 
  - Longer-term Google Trends (weeks/months, not days)
  - News impact on underlying holdings, not the ETF ticker itself
  - Sector composition changes and rebalancing events
- **Exit Strategy:** Lower sensitivity to short-term confidence drops; focus on macro thesis breaks

**Team Impact:**
- **Malcolm:** Update TradingEngine thresholds for ETF vs stock exit rules
- **Signal Collector:** Adjust macro trends and news interpretation for ETF holdings
- **Analysis:** Separate scoring models for stock vs ETF recommendations

---

## 2026-04-17: Portfolio Page Sell + Strategy UI

**Author:** Ellie (Frontend) + Muldoon (Backend)  
**Date:** 2026-04-17  
**Status:** Implemented  

### Context

Jan requested four Portfolio page improvements:
1. Fix stock name field (`stock_name` → `name`)
2. Add sell modal with manual trade capability
3. Display strategy and stop-loss status
4. Auto-refresh prices on page load

### Decisions

1. **Sell Modal Uses `POST /api/portfolio/sell`**
   - Body: `{ symbol, quantity, price }`
   - Implementation: Muldoon uses `executeTrade()` with confidence 1.0, signal snapshot `{ manual: true, user_initiated: true }`
   - Frontend invalidates: `positions`, `dashboard`, `portfolio-history`, `trades` queries

2. **Strategy Object on Each Position**
   - Fields: `asset_type`, `stop_loss_pct`, `stop_loss_price`, `min_holding_days`, strategy note
   - Ellie: Columns render nothing if `strategy` undefined (safe backward compat)
   - Muldoon: Stock vs ETF asset-specific data from tradingEngine

3. **Price Refresh Endpoint: `POST /api/portfolio/refresh-prices`**
   - Exposes existing `refreshPositionPrices()` via API
   - Fires once on Portfolio mount (silent failure, background enhancement)

4. **Stop-Loss Status Thresholds** (Frontend Display)
   - **Safe:** P&L > 0%
   - **Watch:** 0% to 50% of stop-loss price
   - **Danger:** 50% to stop-loss price
   - **TRIGGERED:** At or past stop-loss
   - Note: Actual sell trigger logic lives in Malcolm's strategy engine

### Implementation

**Backend (Muldoon):**
- `POST /api/portfolio/sell` in server/src/routes/api.ts
- `POST /api/portfolio/refresh-prices` in server/src/routes/api.ts
- Enhanced `GET /portfolio/positions` returns `strategy` object
- Exported `STOCK_THRESHOLDS`, `ETF_THRESHOLDS`, `getThresholds()`, `AssetThresholds` from tradingEngine.ts

**Frontend (Ellie):**
- Fixed `stock_name` → `name` mapping in client/src/pages/Portfolio.tsx and client/src/api/client.ts
- Sell modal with validation in client/src/pages/Portfolio.tsx and client/src/hooks/useApi.ts
- Strategy + stop-loss columns render thresholds and status
- Auto price refresh on Portfolio mount

### Team Impact
- **Muldoon:** Backend ready for frontend consumption
- **Ellie:** API contracts and endpoints ready to integrate
- **Wu:** New endpoints need test coverage
- **Malcolm:** No changes — thresholds are read-only exports
- **Jan:** Portfolio page now supports manual sells and strategy visibility

#### 4. Reuse Existing Pipeline (No Duplication)
- **Why:** The scheduled analysis pipeline is battle-tested (market data → signals → confidence → trading). Don't reinvent the wheel.
- **Implementation:** Reactive monitor is a thin orchestration layer that calls `analyzeStock()`, `shouldBuy()`, `shouldSell()`, and `executeTrade()` — the same functions used by the 4-hour cycle.

#### 5. Tagging with "REACTIVE:" Prefix
- **Why:** Clear attribution to news events vs. scheduled analysis. Enables learning engine to evaluate reactive trades separately.
- **Format:** `REACTIVE: Oil prices surge on Iran tensions. Valuation strong, momentum bullish.`

#### 6. Database Tracking (reactive_events Table)
- **Why:** Historical record of all events detected, even if no trades executed. Useful for tuning and debugging.
- **Schema:** impact level, event summary, news headlines (JSON), buy/sell candidates (JSON), trades executed, timestamps.

#### 7. Graceful Degradation
- **Why:** Reactive monitor is supplementary — scheduled analysis is the core pipeline. If reactive fails (no API key, LLM unavailable, rate limits), the agent continues functioning.
- **Implementation:** All errors logged as warnings, execution continues.

### Integration Points

- **Scheduler:** Added to `scheduler.ts` as 5th cron task alongside analysis, snapshots, learning, discovery.
- **API Endpoints:** `POST /api/reactive/trigger` (manual testing), `GET /api/reactive/history` (view past events).
- **Activity Logging:** All events logged at verbosity 2-3 for monitoring.

### Trade-Offs

- **Latency:** 30-minute polling means we're not INSTANT (could be 0-30 min delay after news breaks). Acceptable given API limits and focus on high-impact events.
- **LLM Cost:** Every 30-minute poll sends ~30 headlines to LLM (~500 tokens). At gpt-5.4-mini prices, this is negligible.
- **False Positives:** LLM might flag events that don't materialize. Confidence threshold (0.55) filters out weak signals.

### Future Improvements (Out of Scope)

- **Real-time webhooks:** If Finnhub offers webhooks, switch from polling to push notifications.
- **Sentiment threshold:** Only trigger if aggregate news sentiment crosses a threshold (e.g., 3+ negative articles on same topic).
- **Multi-source news:** Add Bloomberg, Reuters, Twitter sentiment for broader coverage.

### Team Impact

- **Malcolm (Signals):** No changes needed — reactive monitor reuses existing signal analyzers.
- **Ellie (Frontend):** Can add "Reactive Events" section to dashboard showing recent high-impact events and trades executed.
- **Wu (Testing):** May want to add unit tests for LLM prompt parsing and event detection logic.
- **Grant (Architecture):** Reactive monitor follows established patterns (graceful degradation, activity logging, snake_case API, etc.).

### ETF Signal Weights
| Signal | Weight | Focus |
|--------|--------|-------|
| Macro Trend | 30% | Interest rates, inflation, trade policy, geopolitical events |
| Sector Momentum | 25% | Price trend analysis, sector rotation detection |
| Market Sentiment | 20% | Broad market mood from news (vs company-specific) |
| Search Interest | 15% | Sustained interest patterns (vs daily spikes) |
| Valuation | 10% | Basic P/E and yield (lower weight) |

### Implementation Details

**1. Signal Modules (`server/src/services/signals/etfSignals.ts`)**
- **Macro Trend:** Keyword analysis on news for macro themes + Finnhub sentiment. 7-day half-life (vs 24hr for stocks).
- **Sector Momentum:** 20-day vs 60-day return comparison, momentum acceleration detection. Future: sector benchmark comparison.
- **Market Sentiment:** 3-day half-life news sentiment with consensus measurement. Broader focus than company-specific.
- **Search Interest:** Less contrarian penalty for high sustained interest (normal for popular ETFs).
- **Valuation:** P/E vs market average (20) and dividend yield. Confidence capped at 0.7 (vs 0.85 for stocks).

**2. Signal Routing (`server/src/services/signals/index.ts`)**
- Added `analyzeAsset(stock, marketData)` dispatcher
- Routes to `analyzeETF()` or `analyzeStock()` based on `stock.assetType`
- Both return same `AggregateSignalResult` interface for pipeline consistency

**3. LLM Reasoning (`server/src/services/llm/reasoningEngine.ts`)**
- Created `SYSTEM_PROMPT_ETF` emphasizing:
  - Macro-economic outlook and geopolitical context
  - Sector rotation and momentum
  - Longer investment horizon
  - ETF composition and concentration risk
- `analyzeWithReasoning()` now accepts `assetType` parameter
- Routes to ETF or stock prompt automatically

**4. Pipeline Integration (`server/src/services/scheduler.ts`)**
- Uses `analyzeAsset()` dispatcher — automatic routing based on `assetType`
- LLM reasoning receives correct asset type
- No code changes needed for future ETF additions

## Rationale

**Why separate pipelines instead of unified?**
- ETFs and stocks are fundamentally different asset types with different drivers
- Attempting to unify would dilute signal quality for both
- Separate pipelines allow each to evolve independently
- Learning engine can tune weights separately per asset type

**Why these specific weights?**
- Macro Trend (30%): ETFs are macro bets — interest rates, inflation, geopolitical events drive returns
- Sector Momentum (25%): Sector rotation is key — outperformance comes from being in the right sector at the right time
- Market Sentiment (20%): Broad market mood matters more than individual company news
- Search Interest (15%): Lower weight than stocks — sustained interest is normal for popular ETFs
- Valuation (10%): ETF P/E is aggregate of holdings, less actionable than stock P/E

**Why longer time horizons?**
- ETFs are typically held longer than individual stocks
- Macro trends play out over weeks/months, not days
- Reduces noise from daily volatility
- News sentiment uses 3-7 day half-life vs 24hr for stocks

## Consequences

**Benefits:**
- ETFs get analysis optimized for their characteristics
- Better signal quality for both stocks and ETFs
- Explicit separation makes code easier to understand and maintain
- Future: can add more asset types (crypto, commodities) with same pattern

**Trade-offs:**
- More code to maintain (2 pipelines vs 1)
- Learning engine needs to track weights separately per asset type
- Team needs to understand when to use each pipeline

**Migration:**
- Existing stocks unaffected — continue using stock pipeline
- New ETFs automatically routed to ETF pipeline via `assetType` field
- No database schema changes needed

## Validation

- Build succeeds with no TypeScript errors
- All 82 existing tests pass (signal aggregation, trading engine, API)
- Graceful degradation: missing data → neutral score, low confidence
- LLM prompting tested with both asset types

## Future Enhancements

1. **Sector Benchmark Comparison:** Compare ETF momentum vs sector index (e.g., XLF vs financials index)
2. **Correlation Analysis:** Measure ETF correlation with market indices (SPY, QQQ) for diversification scoring
3. **Holdings Analysis:** Parse ETF top holdings and weight signals by concentration
4. **Macro Indicator Integration:** Direct macro data feeds (Fed rate decisions, GDP, CPI) vs news proxy
5. **Geographic Risk Scoring:** For international ETFs, add country/region risk analysis

## Notes

- All signals use same 0-100 score range and SignalResult interface
- DB storage still uses -1..+1 compositeScore: `(score - 50) / 50`
- Custom weights from learning engine work for both stocks and ETFs
- Scheduler automatically routes based on `stock.assetType` field

---

# Decision: ETF-Specific Analysis Pipeline Backend Wiring

**Author:** Muldoon (Backend Dev)  
**Date:** 2026-04-16  
**Status:** Implemented  
**Requested by:** Jan G.

## Context
The analysis pipeline previously treated all assets (stocks and ETFs) the same way, using stock-specific signals. Malcolm is creating ETF-specific analysis logic in `etfSignals.ts` that handles ETF fundamentals differently. The backend needs to route assets to the appropriate analyzer based on `asset_type`.

## Changes

### 1. Scheduler Analysis Routing (`scheduler.ts`)
- **Added dynamic routing**: When analyzing an asset, check `stock.asset_type` (from DB column)
- **ETF path**: If `asset_type === 'etf'` AND `analyzeETF` is available, call the ETF analyzer
- **Stock path**: Otherwise, use the existing `analyzeStock()` analyzer
- **Graceful degradation**: If ETF signals aren't ready yet, fall back to stock analysis with a warning log
- **Logging**: Added verbose activity logging to show which pipeline was selected: `"[Scheduler] ${symbol}: Using ETF analysis pipeline"` vs stock pipeline

### 2. Reasoning Engine Integration (`reasoningEngine.ts`)
- **New parameter**: `analyzeWithReasoning()` now accepts `assetType: string = 'stock'` (6th parameter)
- **Prompt context**: LLM prompt now displays "ETF: SPY" vs "Stock: AAPL" based on asset type
- **ETF-aware prompts**: Malcolm is updating the LLM system prompt to handle ETF-specific reasoning

### 3. API Type Filtering (`api.ts`)
- **Watchlist filtering**: `GET /api/watchlist?type=stock` or `?type=etf` now supported
- **Query parameter**: Optional `type` param filters results by `asset_type` column
- **WHERE clause**: Added `AND s.asset_type = ?` when type is provided
- **Response**: Already includes `asset_type` column from DB (no schema changes needed)

### 4. ETF Signals Import (Stub)
- **Dynamic import**: Try-catch wrapper attempts to load `./signals/etfSignals.ts`
- **Fallback**: If Malcolm hasn't created the file yet, `analyzeETF` is `null` and scheduler falls back
- **Function signature**: Malcolm's `analyzeETF(marketData: MarketData): Promise<AggregateSignalResult>` matches `analyzeStock` interface

## Key Design Decisions

### Asset Type Propagation
- Asset type flows from DB → scheduler → analyzer → reasoning engine → logs
- No hardcoded assumptions — all asset-specific logic gates on runtime checks

### Backward Compatibility
- Stock analysis continues unchanged
- ETFs can use stock analysis until Malcolm's ETF signals are ready
- No breaking changes to existing API contracts or DB schema

### Logging Verbosity
- Asset type logged at verbosity level 3 (normal) for pipeline decision visibility
- ETF fallback warning at verbosity level 3 for operator awareness
- Full signal breakdown already at level 4/5 (unchanged)

## Files Modified
1. `server/src/services/scheduler.ts` — routing logic, ETF import stub, asset_type parameter flow
2. `server/src/services/llm/reasoningEngine.ts` — added assetType parameter, updated prompts
3. `server/src/routes/api.ts` — added type filtering to watchlist endpoint

## Testing Notes
- TypeScript compilation: ✅ Clean (`tsc --noEmit`)
- Backward compatibility: Stock analysis unchanged
- ETF routing: Will activate when Malcolm creates `etfSignals.ts`
- API filtering: Can test with `curl http://localhost:3001/api/watchlist?type=etf`

## Next Steps
1. Malcolm creates `server/src/services/signals/etfSignals.ts` with `analyzeETF()` function
2. Malcolm updates LLM system prompt in `reasoningEngine.ts` with ETF-specific guidance
3. Ellie can add "Stock" / "ETF" filter toggle to the Analysis page
4. Wu may want integration tests for ETF routing logic

## Team Impact
- **Malcolm**: Can now create ETF signals independently without touching scheduler
- **Ellie**: API supports type filtering for frontend asset type toggles
- **Grant**: Architecture supports multi-asset-type expansion (bonds, commodities, etc.)

---

# Decision: Discovery Page ETF/Stock Separation

**Date:** 2026-04-17  
**Author:** Ellie (Frontend Dev)  
**Status:** Implemented  
**Scope:** Discovery page UX/UI

## Context

The Discovery page was showing all assets (stocks + ETFs) in a single unified table. While functional, this made it difficult to distinguish ETFs from stocks at a glance, especially as the watchlist grows.

## Decision

Implemented a **tab-based layout** to separate stocks and ETFs into distinct views:

### What We Built

1. **Tab Switcher:**
   - Two tabs: "📈 Stocks (N)" and "📊 ETFs (N)" with live counts
   - Active tab gets cyan bottom border + tertiary background
   - Smooth hover transitions for inactive tabs
   - Tabs positioned at top of watchlist card, above the table

2. **Client-Side Filtering:**
   - Filter by `asset_type` field (already in DB, returned by `/api/watchlist`)
   - `stocks = watchlist.filter(s => s.asset_type !== 'etf')`
   - `etfs = watchlist.filter(s => s.asset_type === 'etf')`
   - No backend changes required

3. **ETF Table Enhancements:**
   - Added "Type" column showing orange "ETF" badge
   - Same columns as stock table (Price, P/E, P/B, 52w High/Low, etc.)
   - P/E and P/B less important for ETFs but kept for consistency

4. **Add Stock Form Integration:**
   - Asset type selector syncs with active tab via `useEffect`
   - On Stocks tab → defaults to "stock"
   - On ETFs tab → defaults to "etf"
   - User can manually override if needed

5. **Recently Discovered Section:**
   - Added "Type" badge column (cyan for stocks, orange for ETFs)
   - Shows all recent discoveries regardless of active tab

### Why This Approach

**Considered Alternatives:**

- **Option A: Two separate tables side-by-side**  
  ❌ Too cluttered on smaller screens, harder to scan

- **Option B: Toggle switch instead of tabs**  
  ❌ Less obvious, no counts visible, doesn't scale if we add more asset types later

- **✅ Option C: Tab-based (CHOSEN)**  
  - Clean separation, obvious navigation
  - Counts visible at all times (helps user understand portfolio composition)
  - Scales well if we add bonds, crypto, or other asset types later
  - Matches common UI patterns (users understand tabs)

**Why Client-Side Filtering:**

The backend already returns `asset_type` for every stock. Filtering client-side keeps the page snappy (no extra API calls), simplifies state management, and requires zero backend changes. If the watchlist grows to thousands of items, we can optimize later with backend pagination + filtering.

## Impact

### User Experience
- ✅ **Clarity:** ETFs are now visually distinct from stocks
- ✅ **Speed:** Instant tab switching (no API calls)
- ✅ **Context:** Live counts show portfolio composition at a glance
- ✅ **Convenience:** Add form defaults to the right asset type

### Technical
- ✅ **Zero backend changes** — uses existing `asset_type` field
- ✅ **No new dependencies** — pure React state + memo
- ✅ **TypeScript safe** — compiles clean with strict mode
- ✅ **Hot-reload friendly** — Vite dev server works perfectly

### Future-Proof
- Can easily add more tabs (Bonds, Crypto, Options, etc.) if needed
- Backend can paginate/filter by `asset_type` later for performance
- Tab counts provide analytics insight (e.g., "70% stocks, 30% ETFs")

## Implementation Details

**Files Modified:**
- `client/src/pages/Discovery.tsx` (~600 lines)

**Key State:**
```typescript
const [activeTab, setActiveTab] = useState<TabType>('stocks');

const stocks = useMemo(() => 
  allStocks.filter((s: any) => (s.asset_type ?? s.assetType) !== 'etf'),
  [allStocks]
);

const etfs = useMemo(() => 
  allStocks.filter((s: any) => (s.asset_type ?? s.assetType) === 'etf'),
  [allStocks]
);

const displayedItems = activeTab === 'stocks' ? stocks : etfs;
```

**Styling:**
- Active tab: `border-bottom: 2px solid #00d4ff` (cyan accent)
- ETF badge: `background: #f0883e15, color: #f0883e` (orange)
- Stock badge: `background: #00d4ff15, color: #00d4ff` (cyan)

**Compatibility:**
- Handles both `asset_type` (snake_case) and `assetType` (camelCase) from backend
- Graceful fallback to 'stock' if field is missing

## Team Coordination

**No blockers for:**
- Muldoon (Backend) — no API changes needed
- Malcolm (AI Logic) — no analysis changes needed
- Wu (Testing) — existing tests should pass, may want to add tab-switching test

**Notify:**
- Jan G. — new UX is ready for user testing
- Grant (Infra) — no deployment changes needed

## Rollback Plan

If tabs cause issues, revert to single table view:
1. Set `displayedItems = allStocks` (no filtering)
2. Remove tab switcher UI
3. Add "Type" column to main table instead

Code is clean and modular — rollback would be <10 lines.

---

**Confidence:** High — build passes, dev server runs, no TypeScript errors, follows existing patterns.

