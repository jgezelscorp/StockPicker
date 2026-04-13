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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
