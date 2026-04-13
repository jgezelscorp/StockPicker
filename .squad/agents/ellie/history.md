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

### 2026-04-15 — Stock Detail Modal
- **StockDetailModal.tsx:** Full-screen overlay modal (~500 lines) with multi-section layout: header (symbol, price, badges, position info), interactive multi-timeframe charts (1D/1W/1M/3M/1Y/3Y), technical indicator toggles (SMA 20/50, EMA 12/26, Bollinger, RSI, MACD as sub-charts), key stats grid (12 metrics from fundamentals + technicals), APEX analysis section with signal breakdown bars, and recent trades with expandable rationale.
- **Chart architecture:** Used Recharts `syncId` to sync price, volume, RSI, and MACD charts with shared crosshair cursor. Indicator series data merged from API's `indicator_series` field per timeframe. Bollinger bands rendered as paired `<Area>` components, RSI/MACD as conditional sub-charts (~100px each) toggled by chip buttons.
- **API layer:** Added `getStockDetail(symbolOrId)` to client.ts and `useStockDetail()` hook with 60s staleTime (detail data doesn't need 30s refresh).
- **Clickable symbols everywhere:** Discovery (both watchlist + recently discovered tables), Portfolio (positions table), Dashboard (recent trades + top signals) — all symbol cells now open the modal. Pattern: `useState<string | null>` + conditional `<StockDetailModal>` render.
- **Keyboard/mouse UX:** Escape key closes modal, overlay click closes, body scroll locked while open, underline hover on clickable symbols.

### 2026-04-15 — Activity Log Page
- **ActivityLog.tsx:** Dark terminal-inspired log viewer with SSE live streaming + REST initial fetch, merged and deduplicated by id. Color-coded level badges (info=blue, warn=amber, error=red, reasoning=purple, trade=green, discovery=teal). Expandable JSON details, category/level filters, auto-scroll toggle, pause/resume streaming, clear button.
- **useLogStream.ts:** Custom SSE hook connecting to `/api/logs/stream`. Keeps last 500 entries in state, auto-reconnects on error. Returns `{ logs, connected, clear }`.
- **API layer extended:** `getLogs()` added to client.ts with query param support (limit, offset, category, level, since). `useActivityLogs()` hook in useApi.ts with 10s polling fallback.
- **Layout + Router:** Nav item "Activity Log" with ▤ icon added after Analysis. Route `/activity` registered in App.tsx.
- **Conventions maintained:** Inline styles, CSS variables from globals.css, snake_case API fields, no new dependencies. TypeScript compiles clean.
