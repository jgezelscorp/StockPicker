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

### 2026-04-14 — Real Signal Data Migration
- **MarketData interface expanded:** Added `eps`, `marketCap`, `week52High`, `week52Low`, `revenueGrowth`, `profitMargin`, `newsArticles[]`, and `searchTrend` fields. All optional for backward compat.
- **Valuation signal rewritten:** Consumes real P/E, P/B, div yield from Yahoo Fundamentals. Added market-cap-tier P/E adjustment (mega-caps trade at premium). Added 52-week position scoring (near 52w low with good fundamentals = value opportunity). Added revenue growth + profit margin signals. Confidence scales with data availability: 3 core metrics = 0.85, 2 = 0.65, 1 = 0.45, none = 0.1 neutral. Sector defaults kept as fallback, but real data drives scoring.
- **Sentiment signal rewritten:** Removed all mock/stub functions. Now consumes `marketData.newsArticles` from Finnhub. Recency-weighted sentiment averaging (24-hour half-life). Consensus measurement amplifies signal when articles agree. Social buzz derived as proxy from news volume/intensity (noted for future real social API plug-in). Graceful degradation: no articles → neutral/0.1.
- **Search interest signal rewritten:** Removed all mock/stub functions. Consumes `marketData.searchTrend` from Google Trends. Added contrarian element: very high interest (>80) dampens bullish score. Peak attention + falling = extra bearish. Magnitude-scaled scoring (±0.6 per percent change, capped ±30).
- **Trend signal minor fix:** Improved partial-data handling — when 50–199 days of history available, SMA50 still produces meaningful momentum signal instead of defaulting to neutral.
- All signals handle missing data gracefully: score 50, confidence 0.1, direction neutral. Never throw.
