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

## Trading Engine & Execution

### Trading Threshold Overhaul
**Date:** 2026-04-17  
**Contributors:** Malcolm (Data Engineer)  
**Status:** Implemented

After 10 analysis runs with zero trades, investigation revealed minTradeConfidence threshold (72%) was mathematically unreachable — signal capability maxed at ~55%. Solution: (1) Lower threshold to 0.55 (realistic), (2) Add LLM conviction boost (+15-25% when LLM agrees), (3) Implement tiered position sizing (40% at 55-65% confidence, up to 100% at 85%+), (4) Add soft-buy logic for near-boundary trades. Result: 3 trades executed (MSFT 24@$392, JNJ 40@$240, BAC 182@$53). Tiered sizing manages risk on marginal signals; learning engine ready for feedback-based tuning.

**Files Modified:** `server/src/types.ts`, `server/src/services/scheduler.ts`, `server/src/services/tradingEngine.ts`, `server/src/services/signals/index.ts`

### Event-Driven Stock Discovery
**Date:** 2026-04-17  
**Contributors:** Muldoon (Backend Dev)  
**Status:** Implemented

Added LLM-powered news analysis service to discover stocks aligned with macro events. Pipeline: Finnhub headlines → LLM analysis (geopolitical, policy, sector catalysts, commodity moves) → JSON response parsed for beneficiary stocks/ETFs. Runs every 4 hours integrated into analysis pipeline; adds stocks with discovery_reason, discovery_event, discovered_at metadata. Result: 31 new stocks discovered; 4 macro events identified (OPEC+ cuts → energy beneficiaries, AI chip shortage, interest rate volatility, tech regulation). Graceful fallback if Finnhub/LLM unavailable. Cost: ~0.5¢ per discovery run.

**Files Created:** `server/src/services/eventDrivenDiscovery.ts`  
**Files Modified:** `server/src/db/schema.ts`, `server/src/services/scheduler.ts`, `server/src/routes/api.ts`

### ETF Signal Tuning — Longer-Horizon Analysis
**Date:** 2026-04-17  
**Contributors:** Malcolm (Data Engineer)  
**Status:** Implemented

Retuned all 5 ETF signal analyzers for genuinely longer-term investment horizons per user directive: "ETFs require fundamentally different analysis strategy." Parameter changes across the suite:

| Parameter | Before | After | Rationale |
|-----------|--------|-------|-----------|
| Macro half-life | 7d | 18d | Slower signal decay for 6-12mo horizons |
| Macro keywords | 26 | 54 | Expanded geopolitical/policy coverage |
| Sector lookback | 20/60d | 40/120/200d | Cascading windows: tactical/medium/structural |
| Sentiment half-life | 3d | 7d | Dampen daily noise, preserve consensus |
| Volatility penalty | 10× | 6× | Patient with normal sector dips |
| Pipeline: Macro weight | 30% | 35% | Dominates ETF decision-making |
| Pipeline: Search weight | 15% | 10% | Reduced short-term noise |
| Valuation metrics | P/E, Yield | P/E, P/B, Yield | Added book-value context |
| Consensus amplification | N/A | +5% boost when 3+ sources align | Amplify institutional signals |

Impact: ETF analysis no longer penalizes for daily volatility; macro signals dominate; sector rotations captured at multiple time horizons.

**Files Modified:** `server/src/services/signals/etfSignals.ts`

### ETF-Specific Trading Rules & Thresholds
**Date:** 2026-04-17  
**Contributors:** Muldoon (Backend Dev)  
**Status:** Implemented

Introduced separate trading thresholds for ETFs vs stocks in trading engine. Both `shouldBuy()` and `shouldSell()` now accept `assetType` parameter and apply different confidence, stop-loss, and holding constraints:

| Parameter | Stock | ETF | Rationale |
|-----------|-------|-----|-----------|
| Stop-loss | -8% | -15% | Diversified instruments absorb volatility better |
| Buy confidence | 55% | 60% | Higher bar to enter larger positions |
| Sell confidence | 40% | 50% | Need stronger conviction to exit long-horizon vehicles |
| Protective sell trigger | -0.1 | -0.25 | Mild bearish signals are noise for ETFs |
| Max position % | 15% | 20% | Lower beta justifies larger allocation |
| Min holding period | 0d | 14d | Prevent premature exits on short-term noise |
| Emergency override | -16% (2× stop) | -30% (2× stop) | Force-exit if catastrophic loss despite hold period |

Impact: ETFs no longer sold on same short-term triggers as individual stocks; 14-day minimum hold prevents whipsaws while emergency override prevents holding through true crashes. Trade rationale annotated with `[ETF]` or `[Stock]` tags for audit trail.

**Files Modified:** `server/src/services/tradingEngine.ts`, `server/src/services/scheduler.ts`

---
