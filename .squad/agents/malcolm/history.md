# Malcolm — History

## Core Context
- Project: APEX — Autonomous Stock-Picking Agent
- Stack: Node.js data processing
- User: Jan G.
- Data scope: Market data APIs, valuation metrics, trend detection, sentiment analysis, news signals, confidence scoring, learning system

## Learnings

- Signal pipeline uses 4 analysers (Valuation, Trend, Sentiment, Search Interest) with weights 35/25/20/20 per task spec. Grant's ADR had 6 sources with different weights — I consolidated news + social into one Sentiment signal and deferred Macro until we have real data sources.
- Each signal returns a 0–100 score (internally), mapped to the existing -1..+1 compositeScore for DB storage via `(score - 50) / 50`.
- Learning engine requires 5+ evaluated trades before adjusting weights — conservative ±2% max per cycle to avoid overcorrection.
- Mock data uses deterministic hashing of stock symbols so results are consistent across runs but vary per ticker — makes testing predictable.
- Added `composite: true` to shared/tsconfig.json to fix project reference build chain (was missing from Grant's initial setup).
- Extended shared/src/types.ts with SignalResultDTO, AggregateAnalysisDTO, DecisionAccuracyDTO, LearningReportDTO for frontend consumption.

### 2026-04-13 — Full System Integration
- **Backend Wiring:** Muldoon integrated all 4 signal analysers into `scheduler.ts` pipeline. Market data → signal analysers → aggregator → trading engine → learning feedback loop all working.
- **API Endpoint Validation:** All DTO types now consumed by Muldoon's REST endpoints. Ellie's frontend hooks wrap these endpoints with 30-second refresh.
- **Test Coverage:** Wu's 19 signal tests validate all aggregation logic, scoring ranges (0–100 internal, -1..+1 DB), and weight adjustment bounds (5%–50% per signal).
- **Learning Ready:** 15 Wu tests validate learning engine contracts. Conservative tuning (±2% max, 5-trade minimum) verified. System ready for real trade data to calibrate.
