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

### 2026-04-16 — StockDetailModal Bug Fixes
- **BUG 1 — Chart data keys:** Server returns chart data with UPPERCASE timeframe keys (`1D`, `1W`, etc.) but `TIMEFRAME_KEYS` was mapping to lowercase (`1d`, `1w`). Removed `TIMEFRAME_KEYS` entirely — the `Timeframe` type already matches server keys. Charts now render on all timeframes.
- **BUG 2 — Price/change from quote:** Header was reading `stock.current_price` / `stock.price_change` which don't exist on the stock object. Price data lives in `detail.quote`. Extracted `quote` object and wired `quote.price`, `quote.change`, `quote.change_pct` into the header. Added exchange and currency badges.
- **BUG 3 — Indicator series mapping:** Server returns indicator series at top level (not nested per-timeframe), and only for 3M data. Updated chart data merge to use `indicatorSeries` directly but only when `timeframe === '3M'`.
- **Stats grid enhanced:** Added Volume, Previous Close from quote; P/E and Market Cap now prefer quote values over fundamentals for live data.
- **Confidence field:** Trades and analysis sections now read `t.confidence` with fallback to `t.confidence_level` for compatibility.
- **Key learning:** Always verify API response shape against component field access — the `stock` vs `quote` split is a common pattern where DB metadata and live market data are separate objects.

### 2026-04-16 — Verbosity Level Selector
- **ActivityLog.tsx:** Added verbosity state (default 3) with a compact 1-5 segmented button control in the filter bar between Level dropdown and spacer. Active button uses accent styling, each button shows tooltip with level name (Critical/Important/Normal/Detailed/Debug). Buttons have connected border-radius (pill-group style).
- **API client:** `getLogs()` params extended with optional `max_verbosity` — passed as query param to `GET /api/logs`.
- **useApi.ts:** `useActivityLogs` hook accepts and forwards `max_verbosity` to `getLogs()`. Query key includes the param so react-query refetches on change.
- **useLogStream.ts:** `useLogStream` now accepts optional `maxVerbosity` param, appended to SSE URL as `?max_verbosity=N`. Effect depends on `maxVerbosity` so the EventSource reconnects when verbosity changes.
- **No new dependencies.** TypeScript compiles clean.

### 2026-04-16 — Discovery Page: Exact Timestamps & Countdown Timer
- **Last Analysis card:** Replaced relative-only time with locale-formatted exact date/time (e.g., "Apr 13, 2026 9:39 PM") as the primary value, with relative time ("5m ago") as a `card-subtitle` beneath.
- **Next Scheduled Run card:** Added live countdown timer (`HH:MM:SS`) that ticks every second. Calculates next run client-side as `last_analysis_run + 4 hours`. Shows "Pending" when no last run exists, "Running soon…" when countdown reaches 0. Scheduled time shown as subtitle (e.g., "at 1:39 AM").
- **Custom `useCountdown` hook:** Uses `useState` + `useEffect` with `setInterval(1000)`. Cleans up interval on unmount/target change. Returns `{ remaining, display }`.
- **Helpers added:** `formatDateTime()` for locale-aware date formatting, `getNextRunTime()` for client-side next-run calculation, `formatCountdown()` for `HH:MM:SS` string formatting.
- **Key pattern:** Client-side cron schedule calculation avoids needing a backend change. The 4-hour interval matches the `0 */4 * * *` cron. If the backend adds `next_scheduled_run` later, easy to swap in.
- **No new dependencies.** TypeScript compiles clean.

### 2026-04-16 — Discovery Pane: Last Analysis Timestamp & Countdown Timer
- **New UI Elements:** Discovery page now displays exact locale-formatted timestamp for last analysis run and a live countdown timer to the next scheduled run.
- **Client-side Countdown:** Calculation of next run as lastAnalysisRun + 4h (matches 0 */4 * * * cron). useCountdown hook ticks every second, displays HH:MM:SS.
- **Self-correcting:** On every status refetch (30s interval), countdown resets from fresh lastAnalysisRun value.
- **Files:** client/src/pages/Discovery.tsx updated.
- **Decision captured:** Client-side countdown is hardcoded to 4 hours. Muldoon can later expose next_scheduled_run in API if cron schedule changes.


### 2026-04-16 — Recent Analysis Runs Panel & useAnalysisRuns Hook
- **useAnalysisRuns Hook:** New hook in client/src/hooks/useApi.ts consuming GET /api/analysis-runs endpoint. Auto-refetch interval 30 seconds (consistent with all other hooks). Returns ordered array of last 10 analysis runs with metadata (run ID, started timestamp, duration, stocks, signals, trades, errors, status).
- **Recent Analysis Runs Panel:** Added collapsible "Recent Analysis Runs" section to ActivityLog.tsx. Renders runs in table format with 8 columns: Run#, Started (locale-formatted timestamp), Duration (ms), Stocks, Signals, Trades, Errors, Status (badge). Rows clickable for future expanded detail view. Loading/empty states handled gracefully.
- **Integration:** Displays Muldoon's analysis_runs table data in real-time. Provides frontend visibility into pipeline execution health, throughput, and error patterns.
- **Consistency:** Follows existing hooks pattern. No new dependencies. Placement in ActivityLog alongside verbosity filtering and log stream makes pipeline observability comprehensive.
- **Quality:** TypeScript clean. Tested with mock data before backend endpoint finalization.
- **Team Impact:** Jan gains real-time visibility into system execution. Run history enables quick error diagnosis and throughput monitoring.
