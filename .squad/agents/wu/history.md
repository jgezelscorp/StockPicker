# Wu — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: React + Node.js (test both layers)
- User: Jan G.
- Test scope: Trading logic, signal analysis, API endpoints, portfolio tracking, edge cases, decision quality

## Learnings

- SQLite `was_correct` column stores 0/1 integers, not booleans — filter with `=== 1` not truthiness
- Floating point division in JS needs `toBeCloseTo` not `toBe` for assertions (e.g. 0.30/0.10 ≠ exactly 3)
- In-memory SQLite (`:memory:`) + `initializeSchema()` gives fast, isolated test DBs per test — no cleanup needed
- Tests can validate the full architecture contracts (confidence gating, position sizing, signal weights) using pure logic + DB schema even before service implementations land
- Vitest with `@apex/shared` alias in vitest.config.ts resolves workspace package types correctly
- 82 tests across 5 suites: tradingEngine (22), signals (19), portfolioTracker (17), learningEngine (15), api (9)

### 2026-04-13 — Full Build Validation Complete
- **82 Tests All Passing (100% Success Rate)**
  - Trading Engine (22): Entry 72%, exit 40% confidence thresholds, stop-loss -8%, position sizing 15% max / 20 positions / 10% cash reserve
  - Signals (19): Valuation/Trend/Sentiment/Search scores 0–100, aggregation -1..+1 mapping, weighted average 35/25/20/20
  - Portfolio Tracker (17): P&L, snapshots, Sharpe ratio, decision bucketing by confidence bands
  - Learning Engine (15): Weight adjustment ±2% max, 5-trade minimum, bounds 5%–50% per signal
  - API (9): Dashboard, portfolio, trades, analysis, performance, learning endpoint contracts
- **Cross-Team Contract Validation**
  - Muldoon's trading engine and market data contracts validated
  - Malcolm's signal aggregation and learning engine contracts validated
  - Ellie's API response shape expectations validated
  - Grant's schema assumptions verified end-to-end
- **System Integrity Verified**
  - No external API integration failures — mock data consistent
  - SQLite schema fully initialized and tested
  - Confidence gating and position sizing all constraints enforced
  - Decision quality analysis bucketing working as specified
