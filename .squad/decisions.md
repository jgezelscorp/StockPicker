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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
