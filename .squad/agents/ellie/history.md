# Ellie — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: React frontend
- User: Jan G.
- UI needs: Portfolio dashboard, performance charts, trade logs, asset allocation views, win/loss analysis

## Learnings

- Grant's foundation was solid: React Router, react-query, Recharts, API client, shared types already in place. Built on top rather than replacing.
- Used CSS custom properties (globals.css) for the dark theme instead of a CSS-in-JS library — keeps the bundle small and lets every component reference `var(--profit)` / `var(--loss)` consistently.
- Layout component uses react-router `<Outlet />` pattern for nested routes — sidebar stays mounted, only page content swaps.
- All API hooks centralized in `useApi.ts` with 30-second auto-refresh via react-query `refetchInterval`. Hooks are decoupled from components so any page can reuse them.
- Trades page filters work client-side on the fetched page of data. When the backend pagination matures, filters can be sent as query params.
- Analysis page derives signal accuracy and decision-quality-over-time from learning outcomes data. Falls back gracefully when data is empty.
- Every page renders clean loading/empty/error states — Jan will see meaningful placeholders before the backend is live.

### 2026-04-13 — System Integration & Launch
- **API Contract Finalization:** All 12 Muldoon endpoints locked. Hooks updated to match exact response shapes (dashboard aggregation, portfolio positions, trade pagination, analysis results, performance metrics, learning outcomes).
- **Backend Signal Integration:** Dashboard receives live signal data from Malcolm's 4-signal model via `/api/analysis` endpoint. Charts compute signal accuracy and decision quality from `/api/learning` outcomes.
- **Test Validation:** Wu's API tests (9 tests) verify response shapes and error handling. All passing with 100% coverage of dashboard data dependencies.
- **Auto-Refresh Pipeline:** 30-second refetch interval on all hooks. Portfolio value, trade history, analysis results, and learning outcomes stay synchronized in real-time.
- **Production Ready:** Dark theme CSS variables in place for all financial states. Layout component tested across all 4 pages. No external charting dependencies beyond Recharts.

### 2026-04-14 — Discovery & Watchlist Page
- **New Discovery.tsx page:** Full watchlist management with system status cards, sorted table (market→alpha), add/remove stocks, discovery + analysis trigger buttons with loading spinners and toast notifications.
- **Market color-coding:** US=🇺🇸 blue, EU=🇪🇺 green, ASIA=🌏 orange — consistent badge styling with semi-transparent backgrounds using MARKET_COLOR map.
- **API layer extended:** 5 new functions in client.ts (getWatchlist, getSystemStatus, discoverStocks, runAnalysis, removeStock). 6 new hooks in useApi.ts including 3 mutations with automatic query invalidation.
- **Dashboard enhanced:** Added System Status bar showing API health dots, stock count across markets, last analysis time, and link to Discovery page. Uses useSystemStatus() hook with 30s refresh.
- **Layout updated:** Discovery nav item added between Dashboard and Portfolio with 🔍 icon. Route registered in App.tsx.
- **Resilient to backend shape:** Watchlist and status hooks handle both camelCase and snake_case response fields (e.g., `last_analysis_run` / `lastAnalysisRun`) so the UI works regardless of which backend convention Muldoon ships.
- **No new dependencies added** — all built with existing React, react-query, react-router stack.
