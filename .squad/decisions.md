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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
