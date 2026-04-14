import { EventEmitter } from 'events';
import { getDb } from '../db';

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

// ─── Verbosity levels ───────────────────────────────────────────
// 1 = Critical only (errors, trades executed)
// 2 = Important (+ pipeline start/complete, discovery results)
// 3 = Normal (+ signal collection summaries, trade decisions) — default
// 4 = Detailed (+ per-signal scores, LLM request/response summaries, score breakdowns)
// 5 = Debug (+ raw API responses, full LLM prompts/completions, cache hits/misses, timing data)

export interface ActivityLogEntry {
  id: number;
  level: string;
  category: string;
  symbol: string | null;
  message: string;
  details: string | null;
  verbosity: number;
  created_at: string;
}

// Migrate existing DBs that lack the verbosity column
function ensureVerbosityColumn(): void {
  try {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(activity_log)").all() as any[];
    if (!cols.some((c: any) => c.name === 'verbosity')) {
      db.exec("ALTER TABLE activity_log ADD COLUMN verbosity INTEGER NOT NULL DEFAULT 3 CHECK (verbosity BETWEEN 1 AND 5)");
    }
  } catch {
    // Table may not exist yet — schema init will handle it
  }
}

try { ensureVerbosityColumn(); } catch { /* first boot */ }

export function logActivity(
  level: 'info' | 'warn' | 'error' | 'reasoning' | 'trade' | 'discovery',
  category: 'pipeline' | 'signal' | 'trade' | 'portfolio' | 'discovery' | 'learning' | 'system' | 'llm',
  message: string,
  symbol?: string,
  details?: Record<string, any>,
  verbosity: 1 | 2 | 3 | 4 | 5 = 3,
): ActivityLogEntry {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO activity_log (level, category, symbol, message, details, verbosity)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(level, category, symbol || null, message, details ? JSON.stringify(details) : null, verbosity);

  const entry: ActivityLogEntry = {
    id: result.lastInsertRowid as number,
    level,
    category,
    symbol: symbol || null,
    message,
    details: details ? JSON.stringify(details) : null,
    verbosity,
    created_at: new Date().toISOString(),
  };

  emitter.emit('log', entry);
  console.log(`[Activity] [v${verbosity}] [${level}] [${category}]${symbol ? ` ${symbol}:` : ''} ${message}`);
  return entry;
}

export function getRecentLogs(options: {
  limit?: number;
  category?: string;
  level?: string;
  since?: string;
  offset?: number;
  maxVerbosity?: number;
} = {}): { logs: ActivityLogEntry[]; total: number } {
  const db = getDb();
  const { limit = 100, category, level, since, offset = 0, maxVerbosity } = options;

  const conditions: string[] = [];
  const params: any[] = [];

  if (category) { conditions.push('category = ?'); params.push(category); }
  if (level) { conditions.push('level = ?'); params.push(level); }
  if (since) { conditions.push('created_at > ?'); params.push(since); }
  if (maxVerbosity != null && maxVerbosity >= 1 && maxVerbosity <= 5) {
    conditions.push('verbosity <= ?'); params.push(maxVerbosity);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const total = (db.prepare(`SELECT COUNT(*) as count FROM activity_log ${where}`).get(...params) as any).count;
  const logs = db.prepare(
    `SELECT * FROM activity_log ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as ActivityLogEntry[];

  return { logs, total };
}

export function onLog(listener: (entry: ActivityLogEntry) => void): () => void {
  emitter.on('log', listener);
  return () => emitter.off('log', listener);
}

export function pruneOldLogs(daysToKeep = 30): number {
  const db = getDb();
  const result = db.prepare(
    `DELETE FROM activity_log WHERE created_at < datetime('now', ? || ' days')`
  ).run(`-${daysToKeep}`);
  return result.changes;
}

// Run auto-prune on import
try {
  const pruned = pruneOldLogs();
  if (pruned > 0) {
    console.log(`[ActivityLogger] Pruned ${pruned} log entries older than 30 days`);
  }
} catch {
  // DB may not be initialized yet on first import — that's fine
}
