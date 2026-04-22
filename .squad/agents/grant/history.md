# Grant — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: React + Node.js + Azure Web App
- User: Jan G.
- Markets: US, Europe, Asia (stocks and ETFs)
- Key features: Autonomous analysis, virtual portfolio, conviction-based trading, decision logging, performance tracking, learning/improvement

## Learnings

## 2026-04-22 — APEX Live: Azure Container Apps Deployment SUCCESS

Muldoon successfully deployed APEX to Azure Container Apps (Sweden Central region). All three major architectural initiatives now complete and in production:
- **Grant**: Multi-strategy trading architecture + hedging/shorting framework ✅
- **Malcolm**: Signal engine audit + FRED/Reddit data integration ✅
- **Muldoon**: Azure Container Apps deployment with ACR admin credentials ✅
- **Ellie**: Frontend integration ready
- **Wu**: CI/CD and signal testing infrastructure

**Live Endpoints:**
- Client: https://apex-client.jollyflower-67b1d43f.swedencentral.azurecontainerapps.io
- API (internal): apex-api.internal.jollyflower-67b1d43f.swedencentral.azurecontainerapps.io

**Next Phase for All Agents:**
1. Monitor Container App health and production metrics
2. Scheduler redesign for multi-strategy per-strategy cadences
3. Capital allocation enforcement (25%/35%/40% splits)
4. 15 new signal module integration (5 per strategy)
5. Portfolio-level risk metrics and hedge decision logic

Key decision documented in `.squad/decisions.md`: ACR admin credentials (interim). Future: upgrade SP to Owner role, then migrate to managed identity for security.

---

## Learnings

### Architecture Decisions (2025-01-20)
- **Monorepo with npm workspaces**: `client/`, `server/`, `shared/` — keeps types in sync
- **SQLite via better-sqlite3**: Virtual portfolio, single user — no need for a DB server. WAL mode enabled.
- **Autonomous pipeline via node-cron**: Analysis every 4h, snapshots daily, learning weekly
- **Conviction-based trading**: Min 72% confidence to trade, max 15% position size, max 20 positions
- **Signal pipeline**: 6 sources (P/E, price trend, macro, Google Trends, social sentiment, news) with weighted composite scoring
- **Learning loop**: Weekly evaluation of closed trades, signal accuracy tracking — structural but passive initially

### User Preferences (Jan G.)
- Wants REAL working code, not stubs — foundation must boot and render
- Stack: React + Vite + TypeScript (client), Express + TypeScript (server), Azure Web App target
- Markets: US, EU, Asia — stocks and ETFs
- Values: Full rationale logging, historical tracking, win/loss analysis

### Hedging & Shorting Architecture (2025-07-18)
- **Short selling**: Reuses existing bearish signals (score < 30, confidence > 65%) to open short positions, not just exit longs
- **Position types**: `long` | `short` discriminator added to trades and portfolio_positions tables; portfolio_positions unique constraint changes from `stock_id` to `(stock_id, position_type)`
- **Hedging**: Portfolio-level inverse ETF hedges (SH, PSQ) triggered by high beta, sector concentration, or market downturn signals
- **Risk guardrails**: Max 10% per short (vs 15% longs), max 30% total short exposure, 10% stop-loss on shorts (price up), 25% max hedge exposure, 60% target net exposure
- **Schema changes**: New columns on trades/positions/snapshots, new `hedge_rules` table, portfolio_positions table rebuild (SQLite UNIQUE constraint change)
- **Signal pipeline**: `shortRecommendation` field added to `AggregateSignalResult`; new `hedgeSignal.ts` and `marketRegime.ts` modules
- **Simulated borrow cost**: 2% annually on short positions, accrued daily by scheduler
- **Decision file**: `.squad/decisions/inbox/grant-hedging-shorting-strategy.md`

### Key File Paths
- `server/src/index.ts` — Express server with all API routes
- `server/src/db/schema.ts` — Full SQLite schema (8 tables)
- `server/src/db/index.ts` — Database init with WAL mode
- `server/src/services/scheduler.ts` — Autonomous cron pipeline
- `server/src/types.ts` — Server types + signal weight config
- `shared/src/types.ts` — Shared API types (Stock, Signal, Trade, Position, etc.)
- `client/src/App.tsx` — React router (Dashboard, Portfolio, Trades, Analysis)
- `client/src/api/client.ts` — API client
- `.squad/decisions/inbox/grant-apex-architecture.md` — Full ADR
- `.squad/decisions/inbox/grant-multi-strategy-architecture.md` — Multi-strategy redesign

### Multi-Strategy Architecture (2025-07-19 → 2026-04-22)
- **Three independent strategies**: Momentum/News Trader (25% capital, 5-min reactive), Value/Contrarian (35% capital, 4-hour), Macro ETF Strategist (40% capital, daily-monthly)
- **Per-strategy signal pipelines:**
  - **Momentum** (5 signals): News Velocity 30%, Social Buzz 25%, Volume Spike 20%, Price Momentum 15%, Search Accel 10%
  - **Value** (5 signals): Fundamental Value 35%, Contrarian Sentiment 20%, Mean Reversion 20%, Insider Activity 15%, Quality Score 10%
  - **Macro ETF** (5 signals): Macro Regime 30% (FRED), Yield Curve 20%, Sector Rotation 20%, Political Risk 15%, ETF Rel Value 15%
- **15 signal modules designed**: newsVelocity, socialBuzz, volumeSpike, priceMomentum, searchAccel, fundamentalValue, contrarianSentiment, meanReversion, insiderActivity, qualityScore, macroRegime, yieldCurve, sectorRotation, politicalRisk, etfRelativeValue
- **7 new data sources**: FRED (macro), Reddit (social), SEC EDGAR (insider), StockTwits (social fallback), GDELT (political), NewsAPI (fallback), Alpha Vantage (fallback)
- **Capital allocation guardrails**: 5% drift → soft rebalance, 10% drift → hard trim, correlation guard (40% sector limit), drawdown circuit breaker (-15% → pause 24h)
- **4-phase implementation roadmap**: Phase 1 (momentum signals), Phase 2 (value signals), Phase 3 (macro/ETF signals + data sources), Phase 4 (scheduler redesign + cross-strategy rebalancing)
- **Decision file**: `.squad/decisions.md` — Multi-Strategy Trading Architecture section (merged from inbox 2026-04-22)
- **New data sources designed**: FRED API (macro), Reddit API (social buzz), SEC EDGAR (insider filings), GDELT (political events), StockTwits (sentiment), plus fallback sources for each
- **Per-strategy cadences**: Momentum = 5-min during market hours, Value = 4-hour, Macro ETF = daily with monthly rebalance
- **Risk isolation**: Each strategy has its own capital allocation, position limits, stop-loss rules, and circuit breakers. Portfolio-level guards prevent correlated blowups.
- **Schema additions**: `strategy_state`, `macro_indicators`, `social_mentions`, `insider_transactions`, `strategy_performance` tables. Strategy type columns on trades, positions, analysis_logs, signals.
- **19 new files, 8 modified files** across 4-week phased implementation
- **Key insight**: Current system's weakness is one-size-fits-all scoring — momentum plays and long-term value picks should never share the same confidence thresholds or holding periods
- **Migration path is additive**: Old pipeline continues to work during transition; existing positions classified as 'value' strategy by default
