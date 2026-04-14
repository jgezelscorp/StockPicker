import Database from 'better-sqlite3';

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    -- ─── Stocks & ETFs ─────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS stocks (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol        TEXT    NOT NULL UNIQUE,
      name          TEXT    NOT NULL,
      market        TEXT    NOT NULL CHECK (market IN ('US', 'EU', 'ASIA')),
      asset_type    TEXT    NOT NULL CHECK (asset_type IN ('stock', 'etf')),
      sector        TEXT,
      currency      TEXT    NOT NULL DEFAULT 'USD',
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── Signals (individual data-point captures) ──────────────────
    CREATE TABLE IF NOT EXISTS signals (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id      INTEGER NOT NULL REFERENCES stocks(id),
      source        TEXT    NOT NULL CHECK (source IN (
                      'pe_ratio','price_trend','macro_trend',
                      'google_trends','social_sentiment','news_sentiment')),
      direction     TEXT    NOT NULL CHECK (direction IN ('bullish','bearish','neutral')),
      strength      REAL    NOT NULL CHECK (strength BETWEEN 0 AND 1),
      value         REAL,
      metadata      TEXT,            -- JSON blob for source-specific detail
      captured_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signals_stock   ON signals(stock_id);
    CREATE INDEX IF NOT EXISTS idx_signals_source  ON signals(source);
    CREATE INDEX IF NOT EXISTS idx_signals_time    ON signals(captured_at);

    -- ─── Analysis (composite scoring per stock per run) ────────────
    CREATE TABLE IF NOT EXISTS analysis_logs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id          INTEGER NOT NULL REFERENCES stocks(id),
      composite_score   REAL    NOT NULL,   -- –1 … +1
      confidence_level  REAL    NOT NULL CHECK (confidence_level BETWEEN 0 AND 1),
      signal_breakdown  TEXT    NOT NULL,   -- JSON: per-signal scores
      recommendation    TEXT    NOT NULL CHECK (recommendation IN (
                          'strong_buy','buy','hold','sell','strong_sell')),
      rationale         TEXT    NOT NULL,
      analysed_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_stock ON analysis_logs(stock_id);
    CREATE INDEX IF NOT EXISTS idx_analysis_time  ON analysis_logs(analysed_at);

    -- ─── Trades ────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS trades (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id        INTEGER NOT NULL REFERENCES stocks(id),
      action          TEXT    NOT NULL CHECK (action IN ('buy','sell')),
      quantity         REAL    NOT NULL CHECK (quantity > 0),
      price_per_share  REAL    NOT NULL CHECK (price_per_share > 0),
      total_value      REAL    NOT NULL,
      confidence       REAL    NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      rationale        TEXT    NOT NULL,
      signal_snapshot  TEXT    NOT NULL,   -- JSON: signals at time of trade
      executed_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trades_stock ON trades(stock_id);
    CREATE INDEX IF NOT EXISTS idx_trades_time  ON trades(executed_at);

    -- ─── Portfolio Positions (current open positions) ──────────────
    CREATE TABLE IF NOT EXISTS portfolio_positions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id        INTEGER NOT NULL UNIQUE REFERENCES stocks(id),
      quantity         REAL    NOT NULL CHECK (quantity >= 0),
      average_cost     REAL    NOT NULL,
      current_price    REAL    NOT NULL DEFAULT 0,
      market_value     REAL    NOT NULL DEFAULT 0,
      unrealised_pnl   REAL    NOT NULL DEFAULT 0,
      unrealised_pnl_pct REAL  NOT NULL DEFAULT 0,
      opened_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_positions_stock ON portfolio_positions(stock_id);

    -- ─── Portfolio Snapshots (daily value tracking) ────────────────
    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      total_value      REAL    NOT NULL,
      cash_balance     REAL    NOT NULL,
      invested_value   REAL    NOT NULL,
      total_pnl        REAL    NOT NULL DEFAULT 0,
      total_pnl_pct    REAL    NOT NULL DEFAULT 0,
      position_count   INTEGER NOT NULL DEFAULT 0,
      snapshot_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_time ON portfolio_snapshots(snapshot_at);

    -- ─── Learning Outcomes (post-trade evaluation) ─────────────────
    CREATE TABLE IF NOT EXISTS learning_outcomes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id         INTEGER NOT NULL REFERENCES trades(id),
      expected_return   REAL    NOT NULL,
      actual_return     REAL    NOT NULL,
      holding_days      INTEGER NOT NULL,
      was_correct       INTEGER NOT NULL,  -- 0 or 1
      lessons_learned   TEXT    NOT NULL,  -- JSON: structured learnings
      evaluated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_learning_trade ON learning_outcomes(trade_id);

    -- ─── System State (scheduler metadata) ─────────────────────────
    CREATE TABLE IF NOT EXISTS system_state (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ─── Activity Log (persistent pipeline activity stream) ────────
    CREATE TABLE IF NOT EXISTS activity_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      level       TEXT    NOT NULL CHECK (level IN ('info','warn','error','reasoning','trade','discovery')),
      category    TEXT    NOT NULL CHECK (category IN ('pipeline','signal','trade','portfolio','discovery','learning','system','llm')),
      symbol      TEXT,
      message     TEXT    NOT NULL,
      details     TEXT,  -- JSON blob for structured data (signal scores, reasoning steps, etc.)
      verbosity   INTEGER NOT NULL DEFAULT 3 CHECK (verbosity BETWEEN 1 AND 5),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_log_time  ON activity_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_log_cat   ON activity_log(category);
    CREATE INDEX IF NOT EXISTS idx_activity_log_level ON activity_log(level);

    -- ─── Analysis Runs (pipeline execution history) ─────────────
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at      TEXT,
      duration_ms       INTEGER,
      stocks_analysed   INTEGER NOT NULL DEFAULT 0,
      signals_captured  INTEGER NOT NULL DEFAULT 0,
      trades_executed   INTEGER NOT NULL DEFAULT 0,
      errors_count      INTEGER NOT NULL DEFAULT 0,
      errors            TEXT,  -- JSON array of error strings
      status            TEXT    NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
      created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- Seed initial cash balance if not present
    INSERT OR IGNORE INTO system_state (key, value)
      VALUES ('cash_balance', '100000');
    INSERT OR IGNORE INTO system_state (key, value)
      VALUES ('initial_capital', '100000');
  `);

  // Add fundamental columns to stocks table (safe migration)
  const fundamentalCols = [
    { name: 'pe_ratio', type: 'REAL' },
    { name: 'pb_ratio', type: 'REAL' },
    { name: 'eps', type: 'REAL' },
    { name: 'market_cap', type: 'REAL' },
    { name: 'week_52_high', type: 'REAL' },
    { name: 'week_52_low', type: 'REAL' },
    { name: 'current_price', type: 'REAL' },
    { name: 'fundamentals_updated_at', type: 'TEXT' },
  ];

  for (const col of fundamentalCols) {
    try {
      db.exec(`ALTER TABLE stocks ADD COLUMN ${col.name} ${col.type}`);
    } catch {
      // Column already exists — ignore
    }
  }

  console.log('[DB] Schema initialised');
}
