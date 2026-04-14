# APEX Team Decisions

## Architecture & Data Integration

### Alpha Vantage → Yahoo Finance Migration
**Date:** 2026-04-16  
**Contributors:** Muldoon  
**Status:** Approved

Extended fundamentals (PEG ratio, analyst target, EV multiples, margins) now sourced from Yahoo Finance quoteSummary instead of Alpha Vantage. Rationale: Yahoo Finance free tier is more stable and consistent than AV's 5-req/min and 25-req/day limits. AlphaVantage.ts retained for optional future use.

### Analysis Runs Observability
**Date:** 2026-04-16  
**Contributors:** Muldoon, Ellie  
**Status:** Approved

Added `analysis_runs` database table and `GET /api/analysis-runs` endpoint for pipeline visibility. Frontend displays recent runs in ActivityLog.tsx with duration, stock count, signal/trade/error metrics. Enables real-time monitoring of system throughput and error patterns.

### Fundamental Fields Expansion
**Date:** 2026-04-16  
**Contributors:** Muldoon  
**Status:** Approved

MarketData interface extended with 7 new fields for richer valuation context:
- `peg_ratio` — Growth-adjusted P/E for growth stock evaluation
- `analyst_target_price` — Consensus analyst price targets
- `book_value` — Per-share book value for P/B ratio context
- `ev_to_revenue` — Enterprise value multiple (cyclical stock indicator)
- `ev_to_ebitda` — EV multiple before D&A (asset-heavy company context)
- `earnings_quarterly_growth` — Quarter-over-quarter earnings momentum
- `operating_margin` — Operating efficiency metric

Malcolm's signal analyzers (Valuation 35% weight) now have richer fundamental inputs. No breaking changes; existing signals continue to work with partial data.

---

## Frontend Patterns & Components

### ActivityLog Real-Time Architecture
**Date:** 2026-04-16  
**Contributors:** Ellie  
**Status:** Approved

ActivityLog.tsx implements SSE streaming + REST initial fetch + deduplication pattern. Connected to `/api/logs/stream` for real-time tail. Supports verbosity (1-5) filtering, category/level filtering, pause/resume, and auto-scroll. "Recent Analysis Runs" collapsible panel added for pipeline observability.

### Stock Detail Modal Multi-Timeframe Charts
**Date:** 2026-04-15  
**Contributors:** Ellie  
**Status:** Approved

StockDetailModal.tsx renders 6 timeframes (1D/1W/1M/3M/1Y/3Y) with interactive multi-chart layout: price/volume, technical indicators (SMA/EMA/RSI/MACD/Bollinger), metrics grid. Recharts `syncId` syncs cursor across charts. Indicator series conditionally rendered per timeframe availability. Clickable symbols throughout Discovery, Portfolio, Dashboard now open modal.

---
