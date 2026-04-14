import type {
  Stock, Signal, Trade, Position, PortfolioSnapshot,
  AnalysisResult, LearningOutcome, Market, AssetType,
  SignalSource, SignalDirection, TradeAction,
} from '@apex/shared';

// Re-export shared types so server code can import from one place
export type {
  Stock, Signal, Trade, Position, PortfolioSnapshot,
  AnalysisResult, LearningOutcome, Market, AssetType,
  SignalSource, SignalDirection, TradeAction,
};

// ─── Server-internal types ──────────────────────────────────────

export interface SchedulerConfig {
  /** Cron expression for the main analysis pipeline */
  analysisCron: string;
  /** Cron expression for daily portfolio snapshots */
  snapshotCron: string;
  /** Cron expression for weekly learning evaluation */
  learningCron: string;
  /** Minimum confidence (0–1) to execute a trade */
  minTradeConfidence: number;
  /** Maximum % of portfolio in a single position */
  maxPositionPct: number;
  /** Maximum number of open positions */
  maxOpenPositions: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  analysisCron: '0 */4 * * *',     // every 4 hours
  snapshotCron: '0 18 * * 1-5',    // weekdays at 6 PM
  learningCron: '0 20 * * 0',      // Sundays at 8 PM
  minTradeConfidence: 0.55,        // lowered from 0.72 — was mathematically unreachable
  maxPositionPct: 0.15,
  maxOpenPositions: 20,
};

export interface PipelineRunResult {
  stocksAnalysed: number;
  signalsCaptured: number;
  tradesExecuted: number;
  errors: string[];
  durationMs: number;
}

export interface SignalWeight {
  source: SignalSource;
  weight: number;  // how much this source influences composite score
}

export const DEFAULT_SIGNAL_WEIGHTS: SignalWeight[] = [
  { source: 'pe_ratio',          weight: 0.20 },
  { source: 'price_trend',       weight: 0.20 },
  { source: 'macro_trend',       weight: 0.15 },
  { source: 'google_trends',     weight: 0.10 },
  { source: 'social_sentiment',  weight: 0.15 },
  { source: 'news_sentiment',    weight: 0.20 },
];
