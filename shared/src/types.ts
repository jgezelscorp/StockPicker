// ─── Market & Stock ─────────────────────────────────────────────

export type Market = 'US' | 'EU' | 'ASIA';
export type AssetType = 'stock' | 'etf';

export interface Stock {
  id: number;
  symbol: string;
  name: string;
  market: Market;
  assetType: AssetType;
  sector: string | null;
  currency: string;
  isActive: boolean;
  createdAt: string;
}

// ─── Signals ────────────────────────────────────────────────────

export type SignalSource =
  | 'pe_ratio'
  | 'price_trend'
  | 'macro_trend'
  | 'google_trends'
  | 'social_sentiment'
  | 'news_sentiment';

export type SignalDirection = 'bullish' | 'bearish' | 'neutral';

export interface Signal {
  id: number;
  stockId: number;
  source: SignalSource;
  direction: SignalDirection;
  strength: number;       // 0–1 normalised confidence
  value: number | null;   // raw metric (e.g. P/E = 14.2)
  metadata: string | null; // JSON blob for source-specific detail
  capturedAt: string;
}

// ─── Analysis ───────────────────────────────────────────────────

export interface AnalysisResult {
  id: number;
  stockId: number;
  compositeScore: number;     // –1 (strong sell) … +1 (strong buy)
  confidenceLevel: number;    // 0–1
  signalBreakdown: string;    // JSON: per-signal scores
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  rationale: string;          // human-readable explanation
  analysedAt: string;
}

// ─── Trading ────────────────────────────────────────────────────

export type TradeAction = 'buy' | 'sell';

export interface Trade {
  id: number;
  stockId: number;
  action: TradeAction;
  quantity: number;
  pricePerShare: number;
  totalValue: number;
  confidence: number;
  rationale: string;
  signalSnapshot: string;  // JSON: signals at time of trade
  executedAt: string;
}

// ─── Portfolio ──────────────────────────────────────────────────

export interface Position {
  id: number;
  stockId: number;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealisedPnl: number;
  unrealisedPnlPct: number;
  openedAt: string;
  updatedAt: string;
}

export interface PortfolioSnapshot {
  id: number;
  totalValue: number;
  cashBalance: number;
  investedValue: number;
  totalPnl: number;
  totalPnlPct: number;
  positionCount: number;
  snapshotAt: string;
}

// ─── Learning ───────────────────────────────────────────────────

export interface LearningOutcome {
  id: number;
  tradeId: number;
  expectedReturn: number;
  actualReturn: number;
  holdingDays: number;
  wasCorrect: boolean;
  lessonsLearned: string;   // JSON: structured learnings
  evaluatedAt: string;
}

// ─── API Response Wrappers ──────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Dashboard ──────────────────────────────────────────────────

export interface DashboardSummary {
  portfolio: PortfolioSnapshot;
  recentTrades: Trade[];
  topPositions: Position[];
  pendingAnalyses: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

// ─── Performance ────────────────────────────────────────────────

export interface PerformanceMetrics {
  totalReturn: number;
  totalReturnPct: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeEstimate: number;
  totalTrades: number;
  openPositions: number;
  closedPositions: number;
}

// ─── Signal Analysis (for dashboard consumption) ────────────────

export interface SignalResultDTO {
  source: SignalSource;
  score: number;               // 0–100 (higher = more bullish)
  confidence: number;          // 0–1
  direction: SignalDirection;
  reasoning: string;
}

export interface AggregateAnalysisDTO {
  overallScore: number;        // 0–100 composite score
  overallConfidence: number;   // 0–1
  direction: SignalDirection;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  signals: SignalResultDTO[];
  rationale: string;
  weightedBreakdown: {
    source: SignalSource;
    weight: number;
    score: number;
    weightedScore: number;
    direction: SignalDirection;
  }[];
}

// ─── Learning System ────────────────────────────────────────────

export interface DecisionAccuracyDTO {
  totalEvaluated: number;
  winRate: number;
  avgReturn: number;
  avgHoldingDays: number;
  signalAccuracy: Record<string, {
    avgScore: number;
    correctWhenBullish: number;
    correctWhenBearish: number;
    totalPredictions: number;
  }>;
}

export interface LearningReportDTO {
  evaluatedSince: string;
  accuracy: DecisionAccuracyDTO;
  weightAdjustments: {
    source: SignalSource;
    oldWeight: number;
    newWeight: number;
    reason: string;
  }[];
  currentWeights: { source: SignalSource; weight: number }[];
  insights: string[];
}
