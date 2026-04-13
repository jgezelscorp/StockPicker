# Grant — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: React + Node.js + Azure Web App
- User: Jan G.
- Markets: US, Europe, Asia (stocks and ETFs)
- Key features: Autonomous analysis, virtual portfolio, conviction-based trading, decision logging, performance tracking, learning/improvement

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
